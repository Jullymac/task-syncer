import { pool } from '../client';
import { TABLES } from '../tables';

const T = TABLES.JOB_STATE;

export type JobType = 'initial' | 'reconciliation';
export type JobStatus = 'running' | 'paused' | 'done' | 'failed';

export interface JobState {
  id: string;
  job_type: JobType;
  status: JobStatus;
  cursor: Record<string, unknown> | null;
  started_at: Date;
  updated_at: Date;
}

export const jobStateRepo = {
  async find(jobType: JobType): Promise<JobState | null> {
    const { rows } = await pool.query<JobState>(
      `SELECT * FROM ${T} WHERE job_type = $1`,
      [jobType]
    );
    return rows[0] ?? null;
  },

  async upsertRunning(jobType: JobType): Promise<void> {
    await pool.query(
      `INSERT INTO ${T} (job_type, status, started_at)
       VALUES ($1, 'running', now())
       ON CONFLICT (job_type) DO UPDATE
         SET status = 'running', cursor = NULL, started_at = now(), updated_at = now()`,
      [jobType]
    );
  },

  async saveCursor(jobType: JobType, cursor: Record<string, unknown>): Promise<void> {
    await pool.query(
      `UPDATE ${T} SET cursor = $1, status = 'paused', updated_at = now()
       WHERE job_type = $2`,
      [JSON.stringify(cursor), jobType]
    );
  },

  async markDone(jobType: JobType): Promise<void> {
    await pool.query(
      `UPDATE ${T} SET status = 'done', cursor = NULL, updated_at = now()
       WHERE job_type = $1`,
      [jobType]
    );
  },

  async markFailed(jobType: JobType): Promise<void> {
    await pool.query(
      `UPDATE ${T} SET status = 'failed', updated_at = now() WHERE job_type = $1`,
      [jobType]
    );
  },
};
