import { config } from '../config';
import { ClickUpTask } from './clickup';
import { todoistClient, TodoistTask } from './todoist';
import { taskMappingRepo, TaskMapping } from '../db/repositories/taskMapping';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

type TodoistPriority = 1 | 2 | 3 | 4;

export function mapPriority(clickupPriority: ClickUpTask['priority']): TodoistPriority {
  switch (clickupPriority?.priority) {
    case 'urgent': return 1;
    case 'high':   return 2;
    case 'normal': return 3;
    case 'low':    return 4;
    default:       return 3; // no priority set → normal
  }
}

export function mapStatusLabel(statusType: string): string | null {
  if (statusType === 'open') return 'status: pendente';
  if (statusType === 'closed') return null;
  return 'status: em andamento';
}

export function mapDueDate(clickupDueDate: string | null): string | null {
  if (!clickupDueDate) return null;
  return new Date(Number(clickupDueDate)).toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Label management
// ---------------------------------------------------------------------------

const MANAGED_EXACT = new Set(['TaskSync', 'reassigned']);
const MANAGED_PREFIXES = ['list: ', 'status: '];

function isManagedLabel(label: string): boolean {
  return MANAGED_EXACT.has(label) || MANAGED_PREFIXES.some((p) => label.startsWith(p));
}

function computeLabels(
  current: string[],
  toAdd: string[],
  toRemove: string[]
): string[] {
  const removeSet = new Set(toRemove);
  const nonManaged = current.filter((l) => !isManagedLabel(l));
  const managed = current.filter((l) => isManagedLabel(l) && !removeSet.has(l));
  const newLabels = toAdd.filter((l) => !managed.includes(l));
  return [...nonManaged, ...managed, ...newLabels];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isAssignedToUser(task: ClickUpTask): boolean {
  return task.assignees.some((a) => String(a.id) === config.CLICKUP_USER_ID);
}

async function getParentTodoistId(clickupParentId: string | null): Promise<string | null> {
  if (!clickupParentId) return null;
  const parentMapping = await taskMappingRepo.findByClickupId(clickupParentId);
  return parentMapping?.todoist_task_id ?? null;
}

function buildInitialLabels(listName: string, statusType: string): string[] {
  const labels = ['TaskSync', `list: ${listName}`];
  const statusLabel = mapStatusLabel(statusType);
  if (statusLabel) labels.push(statusLabel);
  return labels;
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

export async function createTask(clickupTask: ClickUpTask): Promise<void> {
  const todoistParentId = await getParentTodoistId(clickupTask.parent);

  const labels = buildInitialLabels(clickupTask.list.name, clickupTask.status.type);

  const created = await todoistClient.createTask({
    content: clickupTask.name,
    description: clickupTask.url,
    project_id: config.TODOIST_SYNC_PROJECT_ID,
    parent_id: todoistParentId,
    priority: mapPriority(clickupTask.priority),
    due_date: mapDueDate(clickupTask.due_date),
    labels,
  });

  await taskMappingRepo.create({
    clickup_task_id: clickupTask.id,
    todoist_task_id: created.id,
    clickup_parent_task_id: clickupTask.parent,
    todoist_parent_task_id: todoistParentId,
    clickup_list_name: clickupTask.list.name,
    is_assigned_to_me: true,
  });

  logger.info('Task created in Todoist', { clickup_id: clickupTask.id, todoist_id: created.id });
}

export async function updateTask(
  clickupTask: ClickUpTask,
  mapping: TaskMapping
): Promise<void> {
  const current = await todoistClient.getTask(mapping.todoist_task_id);

  const statusLabel = mapStatusLabel(clickupTask.status.type);
  const toRemove = MANAGED_PREFIXES.flatMap((p) =>
    current.labels.filter((l) => l.startsWith(p))
  );
  const toAdd: string[] = [`list: ${clickupTask.list.name}`];
  if (statusLabel) toAdd.push(statusLabel);

  const labels = computeLabels(current.labels, toAdd, toRemove);

  await todoistClient.updateTask(mapping.todoist_task_id, {
    content: clickupTask.name,
    description: clickupTask.url,
    priority: mapPriority(clickupTask.priority),
    due_date: mapDueDate(clickupTask.due_date),
    labels,
  });

  if (clickupTask.list.name !== mapping.clickup_list_name) {
    await taskMappingRepo.update(clickupTask.id, { clickup_list_name: clickupTask.list.name });
  }

  logger.info('Task updated in Todoist', { clickup_id: clickupTask.id });
}

export async function completeTask(mapping: TaskMapping): Promise<void> {
  const current = await todoistClient.getTask(mapping.todoist_task_id);

  const toRemove = current.labels.filter(
    (l) => l.startsWith('status: ') || l === 'reassigned'
  );

  if (toRemove.length > 0) {
    const labels = computeLabels(current.labels, [], toRemove);
    await todoistClient.updateTask(mapping.todoist_task_id, { labels });
  }

  await todoistClient.completeTask(mapping.todoist_task_id);
  await taskMappingRepo.remove(mapping.clickup_task_id);

  logger.info('Task completed and removed from mapping', { clickup_id: mapping.clickup_task_id });
}

export async function deleteTask(mapping: TaskMapping): Promise<void> {
  await todoistClient.deleteTask(mapping.todoist_task_id);
  await taskMappingRepo.remove(mapping.clickup_task_id);

  logger.info('Task deleted from Todoist', { clickup_id: mapping.clickup_task_id });
}

export async function handleReassigned(mapping: TaskMapping): Promise<void> {
  const current = await todoistClient.getTask(mapping.todoist_task_id);

  const toRemove = current.labels.filter((l) => l.startsWith('status: '));
  const labels = computeLabels(current.labels, ['reassigned'], toRemove);

  await todoistClient.updateTask(mapping.todoist_task_id, {
    priority: 4,       // none
    due_date: null,    // remove due date
    labels,
  });

  await taskMappingRepo.update(mapping.clickup_task_id, { is_assigned_to_me: false });

  logger.info('Task marked as reassigned', { clickup_id: mapping.clickup_task_id });
}

export async function handleReassignedBack(
  clickupTask: ClickUpTask,
  mapping: TaskMapping
): Promise<void> {
  const current = await todoistClient.getTask(mapping.todoist_task_id);

  const statusLabel = mapStatusLabel(clickupTask.status.type);
  const toRemove = ['reassigned', ...current.labels.filter((l) => l.startsWith('status: '))];
  const toAdd = [`list: ${clickupTask.list.name}`];
  if (statusLabel) toAdd.push(statusLabel);

  const labels = computeLabels(current.labels, toAdd, toRemove);

  await todoistClient.updateTask(mapping.todoist_task_id, {
    content: clickupTask.name,
    description: clickupTask.url,
    priority: mapPriority(clickupTask.priority),
    due_date: mapDueDate(clickupTask.due_date),
    labels,
  });

  await taskMappingRepo.update(clickupTask.id, {
    is_assigned_to_me: true,
    clickup_list_name: clickupTask.list.name,
  });

  logger.info('Task restored after reassignment', { clickup_id: clickupTask.id });
}

// ---------------------------------------------------------------------------
// Reconciliation helper — upsert without duplicating
// ---------------------------------------------------------------------------

export async function upsertFromClickUp(
  clickupTask: ClickUpTask,
  existingTodoistTasks: TodoistTask[]
): Promise<void> {
  const mapping = await taskMappingRepo.findByClickupId(clickupTask.id);
  if (mapping) {
    await updateTask(clickupTask, mapping);
    return;
  }

  // check if a Todoist task already exists (e.g. after DB loss)
  const existing = existingTodoistTasks.find(
    (t) => t.content === clickupTask.name && t.labels.includes('TaskSync')
  );

  if (existing) {
    await taskMappingRepo.create({
      clickup_task_id: clickupTask.id,
      todoist_task_id: existing.id,
      clickup_parent_task_id: clickupTask.parent,
      todoist_parent_task_id: existing.parent_id,
      clickup_list_name: clickupTask.list.name,
    });
    await updateTask(clickupTask, await taskMappingRepo.findByClickupId(clickupTask.id) as TaskMapping);
    logger.info('Task re-linked after DB recovery', { clickup_id: clickupTask.id });
    return;
  }

  await createTask(clickupTask);
}
