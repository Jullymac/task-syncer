import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL client error', { error: err.message });
});

export async function connectDb(): Promise<void> {
  const client = await pool.connect();
  client.release();
  logger.info('Database connection established');
}
