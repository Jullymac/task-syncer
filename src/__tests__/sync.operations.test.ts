import {
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  handleReassigned,
  handleReassignedBack,
  upsertFromClickUp,
} from '../services/sync';
import { todoistClient } from '../services/todoist';
import { taskMappingRepo } from '../db/repositories/taskMapping';
import type { ClickUpTask } from '../services/clickup';
import type { TaskMapping } from '../db/repositories/taskMapping';
import type { TodoistTask } from '../services/todoist';

jest.mock('../services/todoist', () => ({
  todoistClient: {
    getTask: jest.fn(),
    createTask: jest.fn(),
    updateTask: jest.fn(),
    completeTask: jest.fn(),
    deleteTask: jest.fn(),
  },
}));

jest.mock('../db/repositories/taskMapping', () => ({
  taskMappingRepo: {
    findByClickupId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeClickUpTask(overrides: Partial<ClickUpTask> = {}): ClickUpTask {
  return {
    id: 'cu-1',
    name: 'My Task',
    status: { status: 'to do', type: 'open' },
    priority: { id: '3', priority: 'normal' },
    due_date: '1718409600000', // 2024-06-15
    url: 'https://app.clickup.com/t/cu-1',
    list: { id: 'list-1', name: 'Sprint' },
    parent: null,
    assignees: [{ id: 42 }],
    ...overrides,
  };
}

function makeTodoistTask(overrides: Partial<TodoistTask> = {}): TodoistTask {
  return {
    id: 'td-1',
    content: 'My Task',
    description: 'https://app.clickup.com/t/cu-1',
    project_id: 'proj-sync',
    parent_id: null,
    priority: 3,
    due: { date: '2024-06-15' },
    labels: ['TaskSync', 'list: Sprint', 'status: pendente'],
    ...overrides,
  };
}

function makeMapping(overrides: Partial<TaskMapping> = {}): TaskMapping {
  return {
    id: 'map-uuid',
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

const mockedTodoist = todoistClient as jest.Mocked<typeof todoistClient>;
const mockedRepo = taskMappingRepo as jest.Mocked<typeof taskMappingRepo>;

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

describe('createTask', () => {
  beforeEach(() => {
    mockedTodoist.createTask.mockResolvedValue(makeTodoistTask());
    mockedRepo.findByClickupId.mockResolvedValue(null);
    mockedRepo.create.mockResolvedValue(makeMapping());
  });

  it('creates task in Todoist with correct fields', async () => {
    await createTask(makeClickUpTask());

    expect(mockedTodoist.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'My Task',
        description: 'https://app.clickup.com/t/cu-1',
        project_id: 'proj-sync',
        priority: 3, // normal → 3
        due_date: '2024-06-15',
      })
    );
  });

  it('builds initial labels with TaskSync, list and status', async () => {
    await createTask(makeClickUpTask());

    expect(mockedTodoist.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: ['TaskSync', 'list: Sprint', 'status: pendente'],
      })
    );
  });

  it('omits status label when status type is closed', async () => {
    const task = makeClickUpTask({ status: { status: 'done', type: 'closed' } });
    await createTask(task);

    const { labels } = mockedTodoist.createTask.mock.calls[0][0];
    expect(labels).not.toContain(expect.stringMatching(/^status:/));
  });

  it('resolves parent todoist_task_id from mapping', async () => {
    const parentMapping = makeMapping({ clickup_task_id: 'cu-parent', todoist_task_id: 'td-parent' });
    mockedRepo.findByClickupId.mockResolvedValue(parentMapping);

    const task = makeClickUpTask({ parent: 'cu-parent' });
    await createTask(task);

    expect(mockedTodoist.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ parent_id: 'td-parent' })
    );
  });

  it('uses null parent_id when task has no parent', async () => {
    await createTask(makeClickUpTask({ parent: null }));

    expect(mockedTodoist.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ parent_id: null })
    );
  });

  it('saves mapping with correct fields', async () => {
    await createTask(makeClickUpTask());

    expect(mockedRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clickup_task_id: 'cu-1',
        todoist_task_id: 'td-1',
        clickup_list_name: 'Sprint',
        is_assigned_to_me: true,
      })
    );
  });
});

// ---------------------------------------------------------------------------
// updateTask
// ---------------------------------------------------------------------------

describe('updateTask', () => {
  beforeEach(() => {
    mockedTodoist.getTask.mockResolvedValue(makeTodoistTask());
    mockedTodoist.updateTask.mockResolvedValue(makeTodoistTask());
    mockedRepo.update.mockResolvedValue(undefined);
  });

  it('fetches current Todoist task before updating', async () => {
    await updateTask(makeClickUpTask(), makeMapping());
    expect(mockedTodoist.getTask).toHaveBeenCalledWith('td-1');
  });

  it('updates content, description, priority and due_date', async () => {
    const task = makeClickUpTask({ name: 'Updated Title', priority: { id: '1', priority: 'urgent' } });
    await updateTask(task, makeMapping());

    expect(mockedTodoist.updateTask).toHaveBeenCalledWith(
      'td-1',
      expect.objectContaining({
        content: 'Updated Title',
        description: 'https://app.clickup.com/t/cu-1',
        priority: 1, // urgent → 1
      })
    );
  });

  it('preserves non-managed labels', async () => {
    mockedTodoist.getTask.mockResolvedValue(
      makeTodoistTask({ labels: ['TaskSync', 'list: Sprint', 'status: pendente', 'my-custom-label'] })
    );

    await updateTask(makeClickUpTask(), makeMapping());

    const { labels } = mockedTodoist.updateTask.mock.calls[0][1];
    expect(labels).toContain('my-custom-label');
  });

  it('replaces old status label with new one', async () => {
    mockedTodoist.getTask.mockResolvedValue(
      makeTodoistTask({ labels: ['TaskSync', 'list: Sprint', 'status: pendente'] })
    );

    const task = makeClickUpTask({ status: { status: 'in review', type: 'custom' } });
    await updateTask(task, makeMapping());

    const { labels } = mockedTodoist.updateTask.mock.calls[0][1];
    expect(labels).toContain('status: em andamento');
    expect(labels).not.toContain('status: pendente');
  });

  it('removes status label when status is closed', async () => {
    mockedTodoist.getTask.mockResolvedValue(
      makeTodoistTask({ labels: ['TaskSync', 'list: Sprint', 'status: em andamento'] })
    );

    const task = makeClickUpTask({ status: { status: 'done', type: 'closed' } });
    await updateTask(task, makeMapping());

    const { labels } = mockedTodoist.updateTask.mock.calls[0][1];
    expect(labels).not.toContain(expect.stringMatching(/^status:/));
  });

  it('updates mapping when list name changed', async () => {
    const task = makeClickUpTask({ list: { id: 'list-2', name: 'Backlog' } });
    await updateTask(task, makeMapping({ clickup_list_name: 'Sprint' }));

    expect(mockedRepo.update).toHaveBeenCalledWith(
      'cu-1',
      expect.objectContaining({ clickup_list_name: 'Backlog' })
    );
  });

  it('does not update mapping when list name unchanged', async () => {
    await updateTask(makeClickUpTask(), makeMapping({ clickup_list_name: 'Sprint' }));
    expect(mockedRepo.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// completeTask
// ---------------------------------------------------------------------------

describe('completeTask', () => {
  beforeEach(() => {
    mockedTodoist.getTask.mockResolvedValue(makeTodoistTask());
    mockedTodoist.updateTask.mockResolvedValue(makeTodoistTask());
    mockedTodoist.completeTask.mockResolvedValue(undefined);
    mockedRepo.remove.mockResolvedValue(undefined);
  });

  it('removes status labels before completing', async () => {
    mockedTodoist.getTask.mockResolvedValue(
      makeTodoistTask({ labels: ['TaskSync', 'list: Sprint', 'status: em andamento'] })
    );

    await completeTask(makeMapping());

    const { labels } = mockedTodoist.updateTask.mock.calls[0][1];
    expect(labels).not.toContain(expect.stringMatching(/^status:/));
  });

  it('removes reassigned label when present', async () => {
    mockedTodoist.getTask.mockResolvedValue(
      makeTodoistTask({ labels: ['TaskSync', 'reassigned'] })
    );

    await completeTask(makeMapping());

    const { labels } = mockedTodoist.updateTask.mock.calls[0][1];
    expect(labels).not.toContain('reassigned');
  });

  it('skips label update when no removable labels exist', async () => {
    mockedTodoist.getTask.mockResolvedValue(
      makeTodoistTask({ labels: ['TaskSync', 'list: Sprint'] })
    );

    await completeTask(makeMapping());

    expect(mockedTodoist.updateTask).not.toHaveBeenCalled();
  });

  it('calls completeTask on Todoist', async () => {
    await completeTask(makeMapping());
    expect(mockedTodoist.completeTask).toHaveBeenCalledWith('td-1');
  });

  it('removes record from task_mapping', async () => {
    await completeTask(makeMapping());
    expect(mockedRepo.remove).toHaveBeenCalledWith('cu-1');
  });
});

// ---------------------------------------------------------------------------
// deleteTask
// ---------------------------------------------------------------------------

describe('deleteTask', () => {
  beforeEach(() => {
    mockedTodoist.deleteTask.mockResolvedValue(undefined);
    mockedRepo.remove.mockResolvedValue(undefined);
  });

  it('deletes task from Todoist', async () => {
    await deleteTask(makeMapping());
    expect(mockedTodoist.deleteTask).toHaveBeenCalledWith('td-1');
  });

  it('removes record from task_mapping', async () => {
    await deleteTask(makeMapping());
    expect(mockedRepo.remove).toHaveBeenCalledWith('cu-1');
  });
});

// ---------------------------------------------------------------------------
// handleReassigned
// ---------------------------------------------------------------------------

describe('handleReassigned', () => {
  beforeEach(() => {
    mockedTodoist.getTask.mockResolvedValue(
      makeTodoistTask({ labels: ['TaskSync', 'list: Sprint', 'status: pendente'] })
    );
    mockedTodoist.updateTask.mockResolvedValue(makeTodoistTask());
    mockedRepo.update.mockResolvedValue(undefined);
  });

  it('sets priority to P4 and removes due date', async () => {
    await handleReassigned(makeMapping());

    expect(mockedTodoist.updateTask).toHaveBeenCalledWith(
      'td-1',
      expect.objectContaining({ priority: 4, due_date: null })
    );
  });

  it('adds reassigned label', async () => {
    await handleReassigned(makeMapping());

    const { labels } = mockedTodoist.updateTask.mock.calls[0][1];
    expect(labels).toContain('reassigned');
  });

  it('removes status label', async () => {
    await handleReassigned(makeMapping());

    const { labels } = mockedTodoist.updateTask.mock.calls[0][1];
    expect(labels).not.toContain(expect.stringMatching(/^status:/));
  });

  it('preserves non-managed labels', async () => {
    mockedTodoist.getTask.mockResolvedValue(
      makeTodoistTask({ labels: ['TaskSync', 'status: pendente', 'my-label'] })
    );

    await handleReassigned(makeMapping());

    const { labels } = mockedTodoist.updateTask.mock.calls[0][1];
    expect(labels).toContain('my-label');
  });

  it('sets is_assigned_to_me to false in mapping', async () => {
    await handleReassigned(makeMapping());

    expect(mockedRepo.update).toHaveBeenCalledWith(
      'cu-1',
      expect.objectContaining({ is_assigned_to_me: false })
    );
  });
});

// ---------------------------------------------------------------------------
// handleReassignedBack
// ---------------------------------------------------------------------------

describe('handleReassignedBack', () => {
  beforeEach(() => {
    mockedTodoist.getTask.mockResolvedValue(
      makeTodoistTask({ labels: ['TaskSync', 'list: Sprint', 'reassigned'] })
    );
    mockedTodoist.updateTask.mockResolvedValue(makeTodoistTask());
    mockedRepo.update.mockResolvedValue(undefined);
  });

  it('removes reassigned label', async () => {
    await handleReassignedBack(makeClickUpTask(), makeMapping());

    const { labels } = mockedTodoist.updateTask.mock.calls[0][1];
    expect(labels).not.toContain('reassigned');
  });

  it('restores status label', async () => {
    await handleReassignedBack(makeClickUpTask({ status: { status: 'to do', type: 'open' } }), makeMapping());

    const { labels } = mockedTodoist.updateTask.mock.calls[0][1];
    expect(labels).toContain('status: pendente');
  });

  it('restores priority and due date', async () => {
    const task = makeClickUpTask({ priority: { id: '1', priority: 'urgent' }, due_date: '1718409600000' });
    await handleReassignedBack(task, makeMapping());

    expect(mockedTodoist.updateTask).toHaveBeenCalledWith(
      'td-1',
      expect.objectContaining({ priority: 1, due_date: '2024-06-15' })
    );
  });

  it('sets is_assigned_to_me to true in mapping', async () => {
    await handleReassignedBack(makeClickUpTask(), makeMapping({ is_assigned_to_me: false }));

    expect(mockedRepo.update).toHaveBeenCalledWith(
      'cu-1',
      expect.objectContaining({ is_assigned_to_me: true })
    );
  });
});

// ---------------------------------------------------------------------------
// upsertFromClickUp
// ---------------------------------------------------------------------------

describe('upsertFromClickUp', () => {
  beforeEach(() => {
    mockedTodoist.getTask.mockResolvedValue(makeTodoistTask());
    mockedTodoist.createTask.mockResolvedValue(makeTodoistTask());
    mockedTodoist.updateTask.mockResolvedValue(makeTodoistTask());
    mockedRepo.create.mockResolvedValue(makeMapping());
  });

  it('calls updateTask when mapping already exists', async () => {
    mockedRepo.findByClickupId.mockResolvedValue(makeMapping());

    await upsertFromClickUp(makeClickUpTask(), []);

    expect(mockedTodoist.updateTask).toHaveBeenCalled();
    expect(mockedTodoist.createTask).not.toHaveBeenCalled();
  });

  it('re-links and updates when Todoist task found by title and TaskSync label (DB recovery)', async () => {
    mockedRepo.findByClickupId
      .mockResolvedValueOnce(null)       // first call: no mapping
      .mockResolvedValueOnce(makeMapping()); // second call: after create

    const existing = makeTodoistTask({ content: 'My Task', labels: ['TaskSync'] });
    await upsertFromClickUp(makeClickUpTask(), [existing]);

    expect(mockedRepo.create).toHaveBeenCalled();
    expect(mockedTodoist.updateTask).toHaveBeenCalled();
    expect(mockedTodoist.createTask).not.toHaveBeenCalled();
  });

  it('does not re-link if Todoist task has no TaskSync label', async () => {
    mockedRepo.findByClickupId.mockResolvedValue(null);

    const existing = makeTodoistTask({ content: 'My Task', labels: [] });
    await upsertFromClickUp(makeClickUpTask(), [existing]);

    // should fall through to createTask
    expect(mockedTodoist.createTask).toHaveBeenCalled();
  });

  it('calls createTask when no mapping and no matching Todoist task', async () => {
    mockedRepo.findByClickupId.mockResolvedValue(null);

    await upsertFromClickUp(makeClickUpTask(), []);

    expect(mockedTodoist.createTask).toHaveBeenCalled();
    expect(mockedTodoist.updateTask).not.toHaveBeenCalled();
  });
});
