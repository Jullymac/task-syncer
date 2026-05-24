import { mapPriority, mapStatusLabel, mapDueDate, isAssignedToUser } from '../services/sync';
import type { ClickUpTask } from '../services/clickup';

const baseTask: ClickUpTask = {
  id: 'task-1',
  name: 'Test task',
  status: { status: 'to do', type: 'open' },
  priority: null,
  due_date: null,
  url: 'https://app.clickup.com/t/task-1',
  list: { id: 'list-1', name: 'My List' },
  parent: null,
  assignees: [],
};

describe('mapPriority', () => {
  it('maps urgent to 1', () => {
    expect(mapPriority({ id: '1', priority: 'urgent' })).toBe(1);
  });

  it('maps high to 2', () => {
    expect(mapPriority({ id: '2', priority: 'high' })).toBe(2);
  });

  it('maps normal to 3', () => {
    expect(mapPriority({ id: '3', priority: 'normal' })).toBe(3);
  });

  it('maps null priority to 3 (normal)', () => {
    expect(mapPriority(null)).toBe(3);
  });

  it('maps none (null string) to 3 (normal)', () => {
    expect(mapPriority({ id: '4', priority: null })).toBe(3);
  });

  it('maps low to 4', () => {
    expect(mapPriority({ id: '5', priority: 'low' })).toBe(4);
  });
});

describe('mapStatusLabel', () => {
  it('maps open to "status: pendente"', () => {
    expect(mapStatusLabel('open')).toBe('status: pendente');
  });

  it('maps closed to null', () => {
    expect(mapStatusLabel('closed')).toBeNull();
  });

  it('maps any custom status to "status: em andamento"', () => {
    expect(mapStatusLabel('in progress')).toBe('status: em andamento');
    expect(mapStatusLabel('review')).toBe('status: em andamento');
  });
});

describe('mapDueDate', () => {
  it('returns null for null input', () => {
    expect(mapDueDate(null)).toBeNull();
  });

  it('converts unix ms timestamp to YYYY-MM-DD', () => {
    // 2024-06-15 00:00:00 UTC in ms
    expect(mapDueDate('1718409600000')).toBe('2024-06-15');
  });
});

describe('isAssignedToUser', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, CLICKUP_USER_ID: '42' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns true when user is in assignees', () => {
    const task: ClickUpTask = { ...baseTask, assignees: [{ id: 42 }] };
    expect(isAssignedToUser(task)).toBe(true);
  });

  it('returns false when user is not in assignees', () => {
    const task: ClickUpTask = { ...baseTask, assignees: [{ id: 99 }] };
    expect(isAssignedToUser(task)).toBe(false);
  });

  it('returns false for empty assignees', () => {
    expect(isAssignedToUser(baseTask)).toBe(false);
  });
});
