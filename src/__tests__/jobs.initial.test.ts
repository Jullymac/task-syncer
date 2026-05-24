import { runInitialJob } from '../jobs/initial';
import { jobStateRepo } from '../db/repositories/jobState';
import { clickupClient } from '../services/clickup';
import { todoistClient } from '../services/todoist';
import { upsertFromClickUp, isAssignedToUser } from '../services/sync';
import { saveForRetry } from '../services/rateLimiter';
import { RateLimitError } from '../services/errors';
import type { JobState } from '../db/repositories/jobState';
import type { ClickUpTask } from '../services/clickup';

jest.mock('../db/repositories/jobState', () => ({
  jobStateRepo: {
    find: jest.fn(),
    upsertRunning: jest.fn(),
    saveCursor: jest.fn(),
    markDone: jest.fn(),
    markFailed: jest.fn(),
  },
}));

jest.mock('../services/clickup', () => ({
  clickupClient: { getTasks: jest.fn() },
}));

jest.mock('../services/todoist', () => ({
  todoistClient: { getTasksByProject: jest.fn() },
}));

jest.mock('../services/sync', () => ({
  upsertFromClickUp: jest.fn(),
  isAssignedToUser: jest.fn(),
}));

jest.mock('../services/rateLimiter', () => ({
  saveForRetry: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedStateRepo = jobStateRepo as jest.Mocked<typeof jobStateRepo>;
const mockedClickup = clickupClient as jest.Mocked<typeof clickupClient>;
const mockedTodoist = todoistClient as jest.Mocked<typeof todoistClient>;
const mockedUpsert = upsertFromClickUp as jest.Mock;
const mockedIsAssigned = isAssignedToUser as jest.Mock;
const mockedSaveForRetry = saveForRetry as jest.Mock;

function makeTask(
  id: string,
  parent: string | null = null,
  assignees: { id: number }[] = [{ id: 42 }]
): ClickUpTask {
  return {
    id,
    name: `Task ${id}`,
    status: { status: 'to do', type: 'open' },
    priority: null,
    due_date: null,
    url: `https://app.clickup.com/t/${id}`,
    list: { id: 'l-1', name: 'Sprint' },
    parent,
    assignees,
  };
}

function makeState(overrides: Partial<JobState> = {}): JobState {
  return {
    id: 'state-1',
    job_type: 'initial',
    status: 'running',
    cursor: null,
    started_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedStateRepo.find.mockResolvedValue(null);
  mockedStateRepo.upsertRunning.mockResolvedValue(undefined);
  mockedStateRepo.saveCursor.mockResolvedValue(undefined);
  mockedStateRepo.markDone.mockResolvedValue(undefined);
  mockedStateRepo.markFailed.mockResolvedValue(undefined);
  mockedClickup.getTasks.mockResolvedValue({ tasks: [], hasMore: false });
  mockedTodoist.getTasksByProject.mockResolvedValue([]);
  mockedUpsert.mockResolvedValue(undefined);
  mockedIsAssigned.mockReturnValue(true);
  mockedSaveForRetry.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

describe('runInitialJob — state management', () => {
  it('skips entirely when job state is done', async () => {
    mockedStateRepo.find.mockResolvedValue(makeState({ status: 'done' }));

    await runInitialJob();

    expect(mockedClickup.getTasks).not.toHaveBeenCalled();
    expect(mockedStateRepo.markDone).not.toHaveBeenCalled();
  });

  it('calls upsertRunning and starts from page 0 on fresh start (no state)', async () => {
    mockedStateRepo.find.mockResolvedValue(null);

    await runInitialJob();

    expect(mockedStateRepo.upsertRunning).toHaveBeenCalledWith('initial');
    expect(mockedClickup.getTasks).toHaveBeenCalledWith(0);
  });

  it('resumes from cursor page without calling upsertRunning', async () => {
    mockedStateRepo.find.mockResolvedValue(makeState({ cursor: { page: 3 } }));

    await runInitialJob();

    expect(mockedClickup.getTasks).toHaveBeenCalledWith(3);
    expect(mockedStateRepo.upsertRunning).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Page processing
// ---------------------------------------------------------------------------

describe('runInitialJob — page processing', () => {
  it('calls upsertFromClickUp for each assigned task on a page', async () => {
    const t1 = makeTask('cu-1');
    const t2 = makeTask('cu-2');
    mockedIsAssigned.mockReturnValue(true);
    mockedClickup.getTasks
      .mockResolvedValueOnce({ tasks: [t1, t2], hasMore: true })
      .mockResolvedValueOnce({ tasks: [], hasMore: false });

    await runInitialJob();

    expect(mockedUpsert).toHaveBeenCalledTimes(2);
    expect(mockedUpsert).toHaveBeenCalledWith(t1, []);
    expect(mockedUpsert).toHaveBeenCalledWith(t2, []);
  });

  it('saves cursor with incremented page number after each page', async () => {
    mockedClickup.getTasks
      .mockResolvedValueOnce({ tasks: [makeTask('cu-1')], hasMore: true })
      .mockResolvedValueOnce({ tasks: [makeTask('cu-2')], hasMore: true })
      .mockResolvedValueOnce({ tasks: [], hasMore: false });

    await runInitialJob();

    expect(mockedStateRepo.saveCursor).toHaveBeenNthCalledWith(1, 'initial', { page: 1 });
    expect(mockedStateRepo.saveCursor).toHaveBeenNthCalledWith(2, 'initial', { page: 2 });
  });

  it('marks job as done after all pages are processed', async () => {
    mockedClickup.getTasks.mockResolvedValue({ tasks: [], hasMore: false });

    await runInitialJob();

    expect(mockedStateRepo.markDone).toHaveBeenCalledWith('initial');
  });
});

// ---------------------------------------------------------------------------
// Subtask buffering
// ---------------------------------------------------------------------------

describe('runInitialJob — subtask buffering', () => {
  it('upserts an unassigned subtask after page loop when its parent was assigned', async () => {
    const parent = makeTask('cu-parent', null, [{ id: 42 }]);
    const subtask = makeTask('cu-sub', 'cu-parent', []);

    mockedIsAssigned.mockImplementation((t: ClickUpTask) => t.id === 'cu-parent');
    mockedClickup.getTasks
      .mockResolvedValueOnce({ tasks: [parent, subtask], hasMore: true })
      .mockResolvedValueOnce({ tasks: [], hasMore: false });

    await runInitialJob();

    expect(mockedUpsert).toHaveBeenCalledWith(subtask, []);
  });

  it('does not upsert an unassigned subtask when its parent was not assigned', async () => {
    const parent = makeTask('cu-parent', null, [{ id: 99 }]);
    const subtask = makeTask('cu-sub', 'cu-parent', []);

    mockedIsAssigned.mockReturnValue(false);
    mockedClickup.getTasks
      .mockResolvedValueOnce({ tasks: [parent, subtask], hasMore: true })
      .mockResolvedValueOnce({ tasks: [], hasMore: false });

    await runInitialJob();

    expect(mockedUpsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('runInitialJob — error handling', () => {
  it('on RateLimitError: saves cursor at current page and schedules retry with retryAfterMs', async () => {
    const err = new RateLimitError(5 * 60 * 1000, 'clickup');
    mockedClickup.getTasks.mockRejectedValue(err);
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation(() => 0 as unknown as NodeJS.Timeout);

    await runInitialJob();

    expect(mockedStateRepo.saveCursor).toHaveBeenCalledWith('initial', { page: 0 });
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);
    expect(mockedStateRepo.markFailed).not.toHaveBeenCalled();
    expect(mockedStateRepo.markDone).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('on generic error: marks failed and saves for retry', async () => {
    const err = new Error('network failure');
    mockedClickup.getTasks.mockRejectedValue(err);

    await runInitialJob();

    expect(mockedStateRepo.markFailed).toHaveBeenCalledWith('initial');
    expect(mockedSaveForRetry).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'job_initial', operation: 'create' }),
      err
    );
    expect(mockedStateRepo.markDone).not.toHaveBeenCalled();
  });
});
