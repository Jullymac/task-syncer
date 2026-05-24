import { pool } from '../client';
import { TABLES } from '../tables';

const T = TABLES.TASK_MAPPING;

export interface TaskMapping {
  id: string;
  clickup_task_id: string;
  todoist_task_id: string;
  clickup_parent_task_id: string | null;
  todoist_parent_task_id: string | null;
  clickup_list_name: string;
  is_assigned_to_me: boolean;
  last_synced_at: Date;
  created_at: Date;
}

export interface CreateTaskMappingInput {
  clickup_task_id: string;
  todoist_task_id: string;
  clickup_parent_task_id?: string | null;
  todoist_parent_task_id?: string | null;
  clickup_list_name: string;
  is_assigned_to_me?: boolean;
}

export const taskMappingRepo = {
  async findByClickupId(clickupTaskId: string): Promise<TaskMapping | null> {
    const { rows } = await pool.query<TaskMapping>(
      `SELECT * FROM ${T} WHERE clickup_task_id = $1`,
      [clickupTaskId]
    );
    return rows[0] ?? null;
  },

  async findByTodoistId(todoistTaskId: string): Promise<TaskMapping | null> {
    const { rows } = await pool.query<TaskMapping>(
      `SELECT * FROM ${T} WHERE todoist_task_id = $1`,
      [todoistTaskId]
    );
    return rows[0] ?? null;
  },

  async findAll(): Promise<TaskMapping[]> {
    const { rows } = await pool.query<TaskMapping>(`SELECT * FROM ${T}`);
    return rows;
  },

  async create(input: CreateTaskMappingInput): Promise<TaskMapping> {
    const { rows } = await pool.query<TaskMapping>(
      `INSERT INTO ${T}
        (clickup_task_id, todoist_task_id, clickup_parent_task_id, todoist_parent_task_id,
         clickup_list_name, is_assigned_to_me, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       RETURNING *`,
      [
        input.clickup_task_id,
        input.todoist_task_id,
        input.clickup_parent_task_id ?? null,
        input.todoist_parent_task_id ?? null,
        input.clickup_list_name,
        input.is_assigned_to_me ?? true,
      ]
    );
    return rows[0];
  },

  async update(
    clickupTaskId: string,
    fields: Partial<Pick<TaskMapping, 'is_assigned_to_me' | 'clickup_list_name' | 'todoist_parent_task_id'>>
  ): Promise<void> {
    const sets: string[] = ['last_synced_at = now()'];
    const values: unknown[] = [];
    let i = 1;

    if (fields.is_assigned_to_me !== undefined) {
      sets.push(`is_assigned_to_me = $${i++}`);
      values.push(fields.is_assigned_to_me);
    }
    if (fields.clickup_list_name !== undefined) {
      sets.push(`clickup_list_name = $${i++}`);
      values.push(fields.clickup_list_name);
    }
    if (fields.todoist_parent_task_id !== undefined) {
      sets.push(`todoist_parent_task_id = $${i++}`);
      values.push(fields.todoist_parent_task_id);
    }

    values.push(clickupTaskId);
    await pool.query(
      `UPDATE ${T} SET ${sets.join(', ')} WHERE clickup_task_id = $${i}`,
      values
    );
  },

  async remove(clickupTaskId: string): Promise<void> {
    await pool.query(`DELETE FROM ${T} WHERE clickup_task_id = $1`, [clickupTaskId]);
  },
};
