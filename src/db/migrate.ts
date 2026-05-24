import fs from 'fs';
import path from 'path';
import { pool } from './client';
import { TABLES } from './tables';
import { logger } from '../utils/logger';

export async function runMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLES.MIGRATIONS} (
      filename VARCHAR PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const { rows } = await pool.query(`SELECT 1 FROM ${TABLES.MIGRATIONS} WHERE filename = $1`, [file]);
    if (rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await pool.query(sql);
    await pool.query(`INSERT INTO ${TABLES.MIGRATIONS} (filename) VALUES ($1)`, [file]);
    logger.info(`Migration applied: ${file}`);
  }
}
