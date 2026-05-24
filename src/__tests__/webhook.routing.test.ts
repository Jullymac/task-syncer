import crypto from 'crypto';
import { validateSignature, replayWebhookEvent } from '../webhooks/clickup';
import { taskMappingRepo } from '../db/repositories/taskMapping';
import { clickupClient } from '../services/clickup';
import * as sync from '../services/sync';
import type { ClickUpTask } from '../services/clickup';
import type { TaskMapping } from '../db/repositories/taskMapping';

jest.mock('../db/repositories/taskMapping', () => ({
  taskMappingRepo: { findByClickupId: jest.fn() },
}));

jest.mock('../services/clickup', () => ({
  clickupClient: { getTask: jest.fn() },
}));

jest.mock('../services/sync', () => ({
  isAssignedToUser: jest.fn(),
  createTask: jest.fn(),
  updateTask: jest.fn(),
  completeTask: jest.fn(),
  deleteTask: jest.fn(),
  handleReassigned: jest.fn(),
  handleReassignedBack: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedRepo = taskMappingRepo as jest.Mocked<typeof taskMappingRepo>;
const mockedClickup = clickupClient as jest.Mocked<typeof clickupClient>;
const mockedSync = sync as jest.Mocked<typeof sync>;

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

beforeEach(() => {
  mockedClickup.getTask.mockResolvedValue(makeTask());
  mockedRepo.findByClickupId.mockResolvedValue(null);
  mockedSync.isAssignedToUser.mockReturnValue(true);
  mockedSync.createTask.mockResolvedValue(undefined);
  mockedSync.updateTask.mockResolvedValue(undefined);
  mockedSync.completeTask.mockResolvedValue(undefined);
  mockedSync.deleteTask.mockResolvedValue(undefined);
  mockedSync.handleReassigned.mockResolvedValue(undefined);
  mockedSync.handleReassignedBack.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// validateSignature
// ---------------------------------------------------------------------------

describe('validateSignature', () => {
  const secret = 'test-secret';
  const body = Buffer.from(JSON.stringify({ event: 'taskCreated', task_id: 'cu-1' }));

  function sign(buf: Buffer): string {
    return crypto.createHmac('sha256', secret).update(buf).digest('hex');
  }

  it('returns true for a valid signature', () => {
    expect(validateSignature(body, sign(body))).toBe(true);
  });

  it('returns false for a tampered body', () => {
    const tampered = Buffer.from('tampered payload');
    expect(validateSignature(tampered, sign(body))).toBe(false);
  });

  it('returns false for a wrong signature', () => {
    expect(validateSignature(body, 'deadbeef')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Event routing via replayWebhookEvent
// ---------------------------------------------------------------------------

describe('replayWebhookEvent — taskDeleted', () => {
  it('calls deleteTask when mapping exists, without fetching task from API', async () => {
    const mapping = makeMapping();
    mockedRepo.findByClickupId.mockResolvedValue(mapping);

    await replayWebhookEvent({ event: 'taskDeleted', task_id: 'cu-1' });

    expect(mockedSync.deleteTask).toHaveBeenCalledWith(mapping);
    expect(mockedClickup.getTask).not.toHaveBeenCalled();
  });

  it('does nothing when no mapping exists for deleted task', async () => {
    mockedRepo.findByClickupId.mockResolvedValue(null);

    await replayWebhookEvent({ event: 'taskDeleted', task_id: 'cu-1' });

    expect(mockedSync.deleteTask).not.toHaveBeenCalled();
  });
});

describe('replayWebhookEvent — taskStatusUpdated', () => {
  it('calls completeTask when status type is closed', async () => {
    const mapping = makeMapping();
    mockedRepo.findByClickupId.mockResolvedValue(mapping);
    mockedClickup.getTask.mockResolvedValue(makeTask({ status: { status: 'done', type: 'closed' } }));

    await replayWebhookEvent({ event: 'taskStatusUpdated', task_id: 'cu-1' });

    expect(mockedSync.completeTask).toHaveBeenCalledWith(mapping);
    expect(mockedSync.updateTask).not.toHaveBeenCalled();
  });

  it('calls updateTask when status type is not closed', async () => {
    const mapping = makeMapping();
    mockedRepo.findByClickupId.mockResolvedValue(mapping);
    mockedClickup.getTask.mockResolvedValue(makeTask({ status: { status: 'in review', type: 'custom' } }));

    await replayWebhookEvent({ event: 'taskStatusUpdated', task_id: 'cu-1' });

    expect(mockedSync.updateTask).toHaveBeenCalledWith(expect.anything(), mapping);
    expect(mockedSync.completeTask).not.toHaveBeenCalled();
  });

  it('does nothing when no mapping exists', async () => {
    mockedRepo.findByClickupId.mockResolvedValue(null);

    await replayWebhookEvent({ event: 'taskStatusUpdated', task_id: 'cu-1' });

    expect(mockedSync.completeTask).not.toHaveBeenCalled();
    expect(mockedSync.updateTask).not.toHaveBeenCalled();
  });
});

describe('replayWebhookEvent — taskCreated', () => {
  it('calls createTask when task is assigned to user and no mapping exists', async () => {
    mockedSync.isAssignedToUser.mockReturnValue(true);

    await replayWebhookEvent({ event: 'taskCreated', task_id: 'cu-1' });

    expect(mockedSync.createTask).toHaveBeenCalled();
  });

  it('does nothing when task is not assigned to user', async () => {
    mockedSync.isAssignedToUser.mockReturnValue(false);

    await replayWebhookEvent({ event: 'taskCreated', task_id: 'cu-1' });

    expect(mockedSync.createTask).not.toHaveBeenCalled();
  });

  it('does nothing when mapping already exists', async () => {
    mockedRepo.findByClickupId.mockResolvedValue(makeMapping());

    await replayWebhookEvent({ event: 'taskCreated', task_id: 'cu-1' });

    expect(mockedSync.createTask).not.toHaveBeenCalled();
  });
});

describe('replayWebhookEvent — taskAssigneeUpdated', () => {
  it('calls handleReassignedBack when newly assigned to user', async () => {
    const mapping = makeMapping({ is_assigned_to_me: false });
    mockedRepo.findByClickupId.mockResolvedValue(mapping);
    mockedSync.isAssignedToUser.mockReturnValue(true);

    await replayWebhookEvent({ event: 'taskAssigneeUpdated', task_id: 'cu-1' });

    expect(mockedSync.handleReassignedBack).toHaveBeenCalledWith(expect.anything(), mapping);
  });

  it('calls handleReassigned when unassigned from user', async () => {
    const mapping = makeMapping({ is_assigned_to_me: true });
    mockedRepo.findByClickupId.mockResolvedValue(mapping);
    mockedSync.isAssignedToUser.mockReturnValue(false);

    await replayWebhookEvent({ event: 'taskAssigneeUpdated', task_id: 'cu-1' });

    expect(mockedSync.handleReassigned).toHaveBeenCalledWith(mapping);
  });

  it('calls createTask when assigned to user for the first time (no mapping)', async () => {
    mockedRepo.findByClickupId.mockResolvedValue(null);
    mockedSync.isAssignedToUser.mockReturnValue(true);

    await replayWebhookEvent({ event: 'taskAssigneeUpdated', task_id: 'cu-1' });

    expect(mockedSync.createTask).toHaveBeenCalled();
  });

  it('does nothing when unassigned and no mapping exists', async () => {
    mockedRepo.findByClickupId.mockResolvedValue(null);
    mockedSync.isAssignedToUser.mockReturnValue(false);

    await replayWebhookEvent({ event: 'taskAssigneeUpdated', task_id: 'cu-1' });

    expect(mockedSync.createTask).not.toHaveBeenCalled();
    expect(mockedSync.handleReassigned).not.toHaveBeenCalled();
  });
});

describe('replayWebhookEvent — taskUpdated / taskPriorityUpdated / taskDueDateUpdated', () => {
  it.each(['taskUpdated', 'taskPriorityUpdated', 'taskDueDateUpdated'] as const)(
    '%s calls updateTask when mapping exists',
    async (event) => {
      const mapping = makeMapping();
      mockedRepo.findByClickupId.mockResolvedValue(mapping);

      await replayWebhookEvent({ event, task_id: 'cu-1' });

      expect(mockedSync.updateTask).toHaveBeenCalledWith(expect.anything(), mapping);
    }
  );

  it.each(['taskUpdated', 'taskPriorityUpdated', 'taskDueDateUpdated'] as const)(
    '%s calls createTask when no mapping but assigned to user',
    async (event) => {
      mockedRepo.findByClickupId.mockResolvedValue(null);
      mockedSync.isAssignedToUser.mockReturnValue(true);

      await replayWebhookEvent({ event, task_id: 'cu-1' });

      expect(mockedSync.createTask).toHaveBeenCalled();
    }
  );
});
