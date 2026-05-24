import cron from 'node-cron';
import { startRetryJob } from '../jobs/retry';
import { pendingEventsRepo } from '../db/repositories/pendingEvents';
import { taskMappingRepo } from '../db/repositories/taskMapping';
import { clickupClient } from '../services/clickup';
import { createTask, updateTask, completeTask, deleteTask } from '../services/sync';
import { replayWebhookEvent } from '../webhooks/clickup';
import { registerRetryHandler, rescheduleOrFail } from '../services/rateLimiter';
import type { PendingEvent } from '../db/repositories/pendingEvents';
import type { ClickUpTask } from '../services/clickup';
import type { TaskMapping } from '../db/repositories/taskMapping';

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

jest.mock('../services/rateLimiter', () => ({
  registerRetryHandler: jest.fn(),
  rescheduleOrFail: jest.fn(),
  processDueRetries: jest.fn(),
}));

jest.mock('../db/repositories/pendingEvents', () => ({
  pendingEventsRepo: {
    markProcessing: jest.fn(),
    remove: jest.fn(),
  },
}));

jest.mock('../db/repositories/taskMapping', () => ({
  taskMappingRepo: { findByClickupId: jest.fn() },
}));

jest.mock('../services/clickup', () => ({
  clickupClient: { getTask: jest.fn() },
}));

jest.mock('../services/sync', () => ({
  createTask: jest.fn(),
  updateTask: jest.fn(),
  completeTask: jest.fn(),
  deleteTask: jest.fn(),
}));

jest.mock('../webhooks/clickup', () => ({
  replayWebhookEvent: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedEventsRepo = pendingEventsRepo as jest.Mocked<typeof pendingEventsRepo>;
const mockedMappingRepo = taskMappingRepo as jest.Mocked<typeof taskMappingRepo>;
const mockedClickup = clickupClient as jest.Mocked<typeof clickupClient>;
const mockedCreateTask = createTask as jest.Mock;
const mockedUpdateTask = updateTask as jest.Mock;
const mockedCompleteTask = completeTask as jest.Mock;
const mockedDeleteTask = deleteTask as jest.Mock;
const mockedReplay = replayWebhookEvent as jest.Mock;
const mockedReschedule = rescheduleOrFail as jest.Mock;
const mockedRegister = registerRetryHandler as jest.Mock;

function makeEvent(overrides: Partial<PendingEvent> = {}): PendingEvent {
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

function makeTask(overrides: Partial<ClickUpTask> = {}): ClickUpTask {
  return {
    id: 'cu-1',
    name: 'Task',
    status: { status: 'to do', type: 'open' },
    priority: null,
    due_date: null,
    url: 'https://app.clickup.com/t/cu-1',
    list: { id: 'l-1', name: 'Sprint' },
    parent: null,
    assignees: [{ id: 42 }],
    ...overrides,
  };
}

function makeMapping(overrides: Partial<TaskMapping> = {}): TaskMapping {
  return {
    id: 'map-1',
    clickup_task_id: 'cu-1',
    todoist_task_id: 'td-1',
    clickup_parent_task_id: null,
    todoist_parent_task_id: null,
    clickup_list_name: 'Sprint',
    is_assigned_to_me: true,
    last_synced_at: new Date(),
    created_at: new Date(),
    ...overrides,
  };
}

function getHandler(): (event: PendingEvent) => Promise<void> {
  return mockedRegister.mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedEventsRepo.markProcessing.mockResolvedValue(undefined);
  mockedEventsRepo.remove.mockResolvedValue(undefined);
  mockedMappingRepo.findByClickupId.mockResolvedValue(null);
  mockedClickup.getTask.mockResolvedValue(makeTask());
  mockedCreateTask.mockResolvedValue(undefined);
  mockedUpdateTask.mockResolvedValue(undefined);
  mockedCompleteTask.mockResolvedValue(undefined);
  mockedDeleteTask.mockResolvedValue(undefined);
  mockedReplay.mockResolvedValue(undefined);
  mockedReschedule.mockResolvedValue(undefined);
  startRetryJob();
});

// ---------------------------------------------------------------------------
// startRetryJob
// ---------------------------------------------------------------------------

describe('startRetryJob', () => {
  it('registers a retry handler', () => {
    expect(mockedRegister).toHaveBeenCalledWith(expect.any(Function));
  });

  it('schedules an hourly cron with pattern "0 * * * *"', () => {
    expect(cron.schedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));
  });
});

// ---------------------------------------------------------------------------
// handleRetry — webhook events
// ---------------------------------------------------------------------------

describe('handleRetry — webhook events', () => {
  it('marks event as processing then calls replayWebhookEvent with the payload', async () => {
    const event = makeEvent({ type: 'webhook' });
    await getHandler()(event);

    expect(mockedEventsRepo.markProcessing).toHaveBeenCalledWith('evt-1');
    expect(mockedReplay).toHaveBeenCalledWith(event.payload);
  });

  it('removes the event on success', async () => {
    await getHandler()(makeEvent({ type: 'webhook' }));
    expect(mockedEventsRepo.remove).toHaveBeenCalledWith('evt-1');
  });

  it('calls rescheduleOrFail and does not remove the event on failure', async () => {
    const err = new Error('replay failed');
    mockedReplay.mockRejectedValue(err);

    await getHandler()(makeEvent({ type: 'webhook' }));

    expect(mockedReschedule).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-1' }), err);
    expect(mockedEventsRepo.remove).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleRetry — job delete
// ---------------------------------------------------------------------------

describe('handleRetry — job delete', () => {
  it('deletes task when mapping exists', async () => {
    const mapping = makeMapping();
    mockedMappingRepo.findByClickupId.mockResolvedValue(mapping);

    await getHandler()(makeEvent({ type: 'job_initial', operation: 'delete' }));

    expect(mockedDeleteTask).toHaveBeenCalledWith(mapping);
    expect(mockedEventsRepo.remove).toHaveBeenCalled();
  });

  it('skips deleteTask when no mapping found, still removes event', async () => {
    await getHandler()(makeEvent({ type: 'job_initial', operation: 'delete' }));

    expect(mockedDeleteTask).not.toHaveBeenCalled();
    expect(mockedEventsRepo.remove).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleRetry — job complete
// ---------------------------------------------------------------------------

describe('handleRetry — job complete', () => {
  it('completes task when mapping exists', async () => {
    const mapping = makeMapping();
    mockedMappingRepo.findByClickupId.mockResolvedValue(mapping);

    await getHandler()(makeEvent({ type: 'job_initial', operation: 'complete' }));

    expect(mockedCompleteTask).toHaveBeenCalledWith(mapping);
    expect(mockedEventsRepo.remove).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleRetry — job create
// ---------------------------------------------------------------------------

describe('handleRetry — job create', () => {
  it('fetches task from ClickUp and creates when no mapping exists', async () => {
    const task = makeTask();
    mockedClickup.getTask.mockResolvedValue(task);

    await getHandler()(makeEvent({ type: 'job_initial', operation: 'create' }));

    expect(mockedClickup.getTask).toHaveBeenCalledWith('cu-1');
    expect(mockedCreateTask).toHaveBeenCalledWith(task);
  });

  it('does not call createTask when mapping already exists', async () => {
    mockedMappingRepo.findByClickupId.mockResolvedValue(makeMapping());

    await getHandler()(makeEvent({ type: 'job_initial', operation: 'create' }));

    expect(mockedCreateTask).not.toHaveBeenCalled();
    expect(mockedEventsRepo.remove).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleRetry — job update
// ---------------------------------------------------------------------------

describe('handleRetry — job update', () => {
  it('fetches task from ClickUp and updates when mapping exists', async () => {
    const task = makeTask();
    const mapping = makeMapping();
    mockedClickup.getTask.mockResolvedValue(task);
    mockedMappingRepo.findByClickupId.mockResolvedValue(mapping);

    await getHandler()(makeEvent({ type: 'job_initial', operation: 'update' }));

    expect(mockedUpdateTask).toHaveBeenCalledWith(task, mapping);
  });

  it('does not call updateTask when no mapping exists', async () => {
    await getHandler()(makeEvent({ type: 'job_initial', operation: 'update' }));

    expect(mockedUpdateTask).not.toHaveBeenCalled();
    expect(mockedEventsRepo.remove).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleRetry — missing clickup_task_id
// ---------------------------------------------------------------------------

describe('handleRetry — missing clickup_task_id', () => {
  it('logs warning, skips all sync operations, and removes event', async () => {
    await getHandler()(makeEvent({ type: 'job_initial', clickup_task_id: null }));

    expect(mockedClickup.getTask).not.toHaveBeenCalled();
    expect(mockedMappingRepo.findByClickupId).not.toHaveBeenCalled();
    expect(mockedEventsRepo.remove).toHaveBeenCalledWith('evt-1');
  });
});
