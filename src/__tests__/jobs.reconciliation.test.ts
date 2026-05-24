import cron from 'node-cron';
import { startReconciliationJob } from '../jobs/reconciliation';
import { jobStateRepo } from '../db/repositories/jobState';
import { taskMappingRepo } from '../db/repositories/taskMapping';
import { clickupClient } from '../services/clickup';
import { todoistClient } from '../services/todoist';
import { upsertFromClickUp, isAssignedToUser, deleteTask } from '../services/sync';
import { saveForRetry } from '../services/rateLimiter';
import { RateLimitError } from '../services/errors';
import type { ClickUpTask } from '../services/clickup';
import type { TaskMapping } from '../db/repositories/taskMapping';

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

jest.mock('../db/repositories/jobState', () => ({
  jobStateRepo: {
    upsertRunning: jest.fn(),
    saveCursor: jest.fn(),
    markDone: jest.fn(),
    markFailed: jest.fn(),
  },
}));

jest.mock('../db/repositories/taskMapping', () => ({
  taskMappingRepo: { findAll: jest.fn() },
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
  deleteTask: jest.fn(),
}));

jest.mock('../services/rateLimiter', () => ({
  saveForRetry: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedStateRepo = jobStateRepo as jest.Mocked<typeof jobStateRepo>;
const mockedMappingRepo = taskMappingRepo as jest.Mocked<typeof taskMappingRepo>;
const mockedClickup = clickupClient as jest.Mocked<typeof clickupClient>;
const mockedTodoist = todoistClient as jest.Mocked<typeof todoistClient>;
const mockedUpsert = upsertFromClickUp as jest.Mock;
const mockedIsAssigned = isAssignedToUser as jest.Mock;
const mockedDeleteTask = deleteTask as jest.Mock;
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

function makeMapping(clickupId: string): TaskMapping {
  return {
    id: `map-${clickupId}`,
    clickup_task_id: clickupId,
    todoist_task_id: `td-${clickupId}`,
    clickup_parent_task_id: null,
    todoist_parent_task_id: null,
    clickup_list_name: 'Sprint',
    is_assigned_to_me: true,
    last_synced_at: new Date(),
    created_at: new Date(),
  };
}

// Flushes all pending microtasks using the real (unspied) setImmediate.
// Must not be called when setTimeout is mocked.
const flushPromises = () =>
  new Promise<void>(resolve =>
    jest.requireActual<typeof import('timers')>('timers').setImmediate(resolve)
  );

function getCronCallback(): () => void {
  return (cron.schedule as jest.Mock).mock.calls[0][1];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedStateRepo.upsertRunning.mockResolvedValue(undefined);
  mockedStateRepo.saveCursor.mockResolvedValue(undefined);
  mockedStateRepo.markDone.mockResolvedValue(undefined);
  mockedStateRepo.markFailed.mockResolvedValue(undefined);
  mockedMappingRepo.findAll.mockResolvedValue([]);
  mockedClickup.getTasks.mockResolvedValue({ tasks: [], hasMore: false });
  mockedTodoist.getTasksByProject.mockResolvedValue([]);
  mockedUpsert.mockResolvedValue(undefined);
  mockedIsAssigned.mockReturnValue(true);
  mockedDeleteTask.mockResolvedValue(undefined);
  mockedSaveForRetry.mockResolvedValue(undefined);

  startReconciliationJob();
});

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

describe('startReconciliationJob', () => {
  it('schedules a daily cron at 03:00 with pattern "0 3 * * *"', () => {
    expect(cron.schedule).toHaveBeenCalledWith('0 3 * * *', expect.any(Function));
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('runReconciliation — happy path', () => {
  it('calls upsertFromClickUp for each eligible ClickUp task', async () => {
    const t1 = makeTask('cu-1');
    const t2 = makeTask('cu-2');
    mockedIsAssigned.mockReturnValue(true);
    mockedClickup.getTasks
      .mockResolvedValueOnce({ tasks: [t1, t2], hasMore: true })
      .mockResolvedValueOnce({ tasks: [], hasMore: false });

    getCronCallback()();
    await flushPromises();

    expect(mockedUpsert).toHaveBeenCalledTimes(2);
    expect(mockedUpsert).toHaveBeenCalledWith(t1, []);
    expect(mockedUpsert).toHaveBeenCalledWith(t2, []);
  });

  it('deletes stale mappings whose task no longer appears in ClickUp', async () => {
    const staleMapping = makeMapping('cu-stale');
    mockedMappingRepo.findAll.mockResolvedValue([staleMapping]);
    mockedClickup.getTasks.mockResolvedValue({ tasks: [], hasMore: false });

    getCronCallback()();
    await flushPromises();

    expect(mockedDeleteTask).toHaveBeenCalledWith(staleMapping);
  });

  it('does not delete a mapping whose task is still present in ClickUp', async () => {
    const task = makeTask('cu-1');
    const mapping = makeMapping('cu-1');
    mockedMappingRepo.findAll.mockResolvedValue([mapping]);
    mockedClickup.getTasks
      .mockResolvedValueOnce({ tasks: [task], hasMore: true })
      .mockResolvedValueOnce({ tasks: [], hasMore: false });

    getCronCallback()();
    await flushPromises();

    expect(mockedDeleteTask).not.toHaveBeenCalled();
  });

  it('marks job as done on successful run', async () => {
    getCronCallback()();
    await flushPromises();

    expect(mockedStateRepo.markDone).toHaveBeenCalledWith('reconciliation');
  });
});

// ---------------------------------------------------------------------------
// Eligible task filtering (fetchAllEligibleTasks)
// ---------------------------------------------------------------------------

describe('runReconciliation — eligible task filtering', () => {
  it('includes an unassigned subtask whose parent is assigned', async () => {
    const parent = makeTask('cu-parent', null, [{ id: 42 }]);
    const subtask = makeTask('cu-sub', 'cu-parent', []);
    mockedIsAssigned.mockImplementation((t: ClickUpTask) => t.id === 'cu-parent');
    mockedClickup.getTasks
      .mockResolvedValueOnce({ tasks: [parent, subtask], hasMore: true })
      .mockResolvedValueOnce({ tasks: [], hasMore: false });

    getCronCallback()();
    await flushPromises();

    expect(mockedUpsert).toHaveBeenCalledWith(subtask, expect.anything());
  });

  it('excludes a task that is not assigned to the user', async () => {
    const task = makeTask('cu-1', null, [{ id: 99 }]);
    mockedIsAssigned.mockReturnValue(false);
    mockedClickup.getTasks
      .mockResolvedValueOnce({ tasks: [task], hasMore: true })
      .mockResolvedValueOnce({ tasks: [], hasMore: false });

    getCronCallback()();
    await flushPromises();

    expect(mockedUpsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('runReconciliation — error handling', () => {
  it('on RateLimitError: saves cursor and schedules retry with retryAfterMs', async () => {
    const err = new RateLimitError(10 * 60 * 1000, 'clickup');
    mockedClickup.getTasks.mockRejectedValue(err);
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation(() => 0 as unknown as NodeJS.Timeout);

    getCronCallback()();
    await flushPromises();

    expect(mockedStateRepo.saveCursor).toHaveBeenCalledWith('reconciliation', { page: 0 });
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 10 * 60 * 1000);
    expect(mockedStateRepo.markFailed).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('on generic error: marks failed and saves for retry', async () => {
    const err = new Error('network error');
    mockedClickup.getTasks.mockRejectedValue(err);

    getCronCallback()();
    await flushPromises();

    expect(mockedStateRepo.markFailed).toHaveBeenCalledWith('reconciliation');
    expect(mockedSaveForRetry).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'job_reconciliation', operation: 'update' }),
      err
    );
    expect(mockedStateRepo.markDone).not.toHaveBeenCalled();
  });
});
