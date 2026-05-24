import { saveForRetry, rescheduleOrFail, processDueRetries, registerRetryHandler } from '../services/rateLimiter';
import { pendingEventsRepo } from '../db/repositories/pendingEvents';
import { createErrorAlert } from '../services/alerting';
import { RateLimitError } from '../services/errors';
import type { PendingEvent, CreatePendingEventInput } from '../db/repositories/pendingEvents';

jest.mock('../db/repositories/pendingEvents', () => ({
  pendingEventsRepo: {
    create: jest.fn(),
    findDueForRetry: jest.fn(),
    scheduleRetry: jest.fn(),
    markFailed: jest.fn(),
  },
}));

jest.mock('../services/alerting', () => ({
  createErrorAlert: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedRepo = pendingEventsRepo as jest.Mocked<typeof pendingEventsRepo>;
const mockedAlert = createErrorAlert as jest.Mock;

function makePendingEvent(overrides: Partial<PendingEvent> = {}): PendingEvent {
  return {
    id: 'evt-1',
    type: 'webhook',
    operation: 'create',
    status: 'pending',
    payload: { event: 'taskCreated', task_id: 'cu-1' },
    clickup_task_id: 'cu-1',
    attempts: 0,
    next_retry_at: new Date(),
    error_log: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeInput(overrides: Partial<CreatePendingEventInput> = {}): CreatePendingEventInput {
  return {
    type: 'webhook',
    operation: 'create',
    payload: { event: 'taskCreated', task_id: 'cu-1' },
    clickup_task_id: 'cu-1',
    next_retry_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockedRepo.create.mockResolvedValue(makePendingEvent());
  mockedRepo.findDueForRetry.mockResolvedValue([]);
  mockedRepo.scheduleRetry.mockResolvedValue(undefined);
  mockedRepo.markFailed.mockResolvedValue(undefined);
  mockedAlert.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// saveForRetry
// ---------------------------------------------------------------------------

describe('saveForRetry', () => {
  it('uses retryAfterMs from RateLimitError for next_retry_at', async () => {
    const now = Date.now();
    jest.setSystemTime(now);

    const err = new RateLimitError(5 * 60 * 1000, 'clickup'); // 5 min
    await saveForRetry(makeInput(), err);

    const savedAt: Date = mockedRepo.create.mock.calls[0][0].next_retry_at;
    expect(savedAt.getTime()).toBe(now + 5 * 60 * 1000);
  });

  it('uses 1 minute backoff for generic errors', async () => {
    const now = Date.now();
    jest.setSystemTime(now);

    await saveForRetry(makeInput(), new Error('something broke'));

    const savedAt: Date = mockedRepo.create.mock.calls[0][0].next_retry_at;
    expect(savedAt.getTime()).toBe(now + 60 * 1000);
  });

  it('saves the event to pending_events', async () => {
    await saveForRetry(makeInput({ operation: 'update', clickup_task_id: 'cu-99' }), new Error('fail'));

    expect(mockedRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'update', clickup_task_id: 'cu-99' })
    );
  });
});

// ---------------------------------------------------------------------------
// rescheduleOrFail — backoff progression
// ---------------------------------------------------------------------------

describe('rescheduleOrFail — backoff progression', () => {
  it('schedules retry with 2 min delay on first reschedule (attempts=0)', async () => {
    const now = Date.now();
    jest.setSystemTime(now);

    // attempts=0 → attempts+1=1 → backoffMs(1) = 2^1 * 60s = 2min
    const event = makePendingEvent({ attempts: 0 });
    await rescheduleOrFail(event, new Error('fail'));

    const nextRetryAt: Date = mockedRepo.scheduleRetry.mock.calls[0][1];
    expect(nextRetryAt.getTime()).toBe(now + 2 * 60 * 1000);
  });

  it('schedules retry with 4 min delay on second reschedule (attempts=1)', async () => {
    const now = Date.now();
    jest.setSystemTime(now);

    // attempts=1 → attempts+1=2 → backoffMs(2) = 2^2 * 60s = 4min
    const event = makePendingEvent({ attempts: 1 });
    await rescheduleOrFail(event, new Error('fail'));

    const nextRetryAt: Date = mockedRepo.scheduleRetry.mock.calls[0][1];
    expect(nextRetryAt.getTime()).toBe(now + 4 * 60 * 1000);
  });

  it('uses RateLimitError delay instead of backoff when rate limited', async () => {
    const now = Date.now();
    jest.setSystemTime(now);

    const event = makePendingEvent({ attempts: 0 });
    const err = new RateLimitError(10 * 60 * 1000, 'todoist');
    await rescheduleOrFail(event, err);

    const nextRetryAt: Date = mockedRepo.scheduleRetry.mock.calls[0][1];
    expect(nextRetryAt.getTime()).toBe(now + 10 * 60 * 1000);
    expect(mockedRepo.markFailed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// rescheduleOrFail — permanent failure (MAX_ATTEMPTS reached)
// ---------------------------------------------------------------------------

describe('rescheduleOrFail — permanent failure', () => {
  it('marks as failed after 3 attempts', async () => {
    const event = makePendingEvent({ attempts: 2 }); // attempts+1 = 3 = MAX_ATTEMPTS
    await rescheduleOrFail(event, new Error('fatal'));

    expect(mockedRepo.markFailed).toHaveBeenCalledWith('evt-1', expect.any(String));
    expect(mockedRepo.scheduleRetry).not.toHaveBeenCalled();
  });

  it('creates an error alert after 3 attempts', async () => {
    const event = makePendingEvent({ attempts: 2, clickup_task_id: 'cu-42', operation: 'update' });
    await rescheduleOrFail(event, new Error('fatal'));

    expect(mockedAlert).toHaveBeenCalledWith(
      expect.stringContaining('update'),
      expect.stringContaining('cu-42')
    );
  });

  it('does not create alert before reaching max attempts', async () => {
    const event = makePendingEvent({ attempts: 0 });
    await rescheduleOrFail(event, new Error('fail'));

    expect(mockedAlert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// processDueRetries
// ---------------------------------------------------------------------------

describe('processDueRetries', () => {
  it('calls the registered handler for each due event', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    registerRetryHandler(handler);

    const events = [makePendingEvent({ id: 'e1' }), makePendingEvent({ id: 'e2' })];
    mockedRepo.findDueForRetry.mockResolvedValue(events);

    await processDueRetries();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith(events[0]);
    expect(handler).toHaveBeenCalledWith(events[1]);
  });

  it('does nothing when there are no due events', async () => {
    const handler = jest.fn();
    registerRetryHandler(handler);
    mockedRepo.findDueForRetry.mockResolvedValue([]);

    await processDueRetries();

    expect(handler).not.toHaveBeenCalled();
  });
});
