import { pool } from '../client';
import { TABLES } from '../tables';

const T = TABLES.PENDING_EVENTS;

export type EventType = 'webhook' | 'job_initial' | 'job_reconciliation';
export type EventOperation = 'create' | 'update' | 'complete' | 'delete';
export type EventStatus = 'pending' | 'processing' | 'failed';

export interface PendingEvent {
  id: string;
  type: EventType;
  operation: EventOperation;
  status: EventStatus;
  payload: Record<string, unknown>;
  clickup_task_id: string | null;
  attempts: number;
  next_retry_at: Date;
  error_log: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreatePendingEventInput {
  type: EventType;
  operation: EventOperation;
  payload: Record<string, unknown>;
  clickup_task_id?: string | null;
  next_retry_at: Date;
}

export const pendingEventsRepo = {
  async create(input: CreatePendingEventInput): Promise<PendingEvent> {
    const { rows } = await pool.query<PendingEvent>(
      `INSERT INTO ${T} (type, operation, payload, clickup_task_id, next_retry_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.type, input.operation, JSON.stringify(input.payload), input.clickup_task_id ?? null, input.next_retry_at]
    );
    return rows[0];
  },

  async findDueForRetry(): Promise<PendingEvent[]> {
    const { rows } = await pool.query<PendingEvent>(
      `SELECT * FROM ${T}
       WHERE status = 'pending' AND next_retry_at <= now()
       ORDER BY next_retry_at ASC`
    );
    return rows;
  },

  async markProcessing(id: string): Promise<void> {
    await pool.query(
      `UPDATE ${T} SET status = 'processing', updated_at = now() WHERE id = $1`,
      [id]
    );
  },

  async markFailed(id: string, errorLog: string): Promise<void> {
    await pool.query(
      `UPDATE ${T}
       SET status = 'failed', error_log = $1, attempts = attempts + 1, updated_at = now()
       WHERE id = $2`,
      [errorLog, id]
    );
  },

  async scheduleRetry(id: string, nextRetryAt: Date, errorLog: string): Promise<void> {
    await pool.query(
      `UPDATE ${T}
       SET status = 'pending', next_retry_at = $1, error_log = $2,
           attempts = attempts + 1, updated_at = now()
       WHERE id = $3`,
      [nextRetryAt, errorLog, id]
    );
  },

  async remove(id: string): Promise<void> {
    await pool.query(`DELETE FROM ${T} WHERE id = $1`, [id]);
  },
};
