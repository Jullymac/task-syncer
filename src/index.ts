import './config'; // validate env first
import express from 'express';
import { config } from './config';
import { connectDb } from './db/client';
import { runMigrations } from './db/migrate';
import { clickupClient } from './services/clickup';
import { webhookRouter } from './webhooks/clickup';
import { runInitialJob } from './jobs/initial';
import { startReconciliationJob } from './jobs/reconciliation';
import { startRetryJob } from './jobs/retry';
import { logger } from './utils/logger';

// ---------------------------------------------------------------------------
// Webhook registration
// ---------------------------------------------------------------------------

async function ensureWebhookRegistered(): Promise<void> {
  const expectedEndpoint = `${config.PUBLIC_URL}/webhook/clickup`;
  const webhooks = await clickupClient.listWebhooks();
  const exists = webhooks.some((w) => w.endpoint === expectedEndpoint);

  if (exists) {
    logger.info('ClickUp webhook already registered');
    return;
  }

  const webhook = await clickupClient.registerWebhook();
  logger.info('ClickUp webhook registered', { id: webhook.id, endpoint: expectedEndpoint });
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  logger.info('task-syncer starting');

  // 1. database
  await connectDb();
  await runMigrations();

  // 2. webhook registration
  await ensureWebhookRegistered();

  // 3. cron jobs (retry handler must be registered before initial job runs)
  startRetryJob();
  startReconciliationJob();

  // 4. initial sync (resumes from cursor if previously interrupted)
  //    upsertFromClickUp inside handles DB-recovery matching automatically
  await runInitialJob();

  // 5. express
  const app = express();

  // raw body handling for the webhook route is done inside webhookRouter itself,
  // so we do NOT add express.json() before it
  app.use('/webhook', webhookRouter);

  // for any future JSON routes
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.listen(config.PORT, () => {
    logger.info(`task-syncer listening on port ${config.PORT}`);
  });
}

start().catch((err) => {
  logger.error('Fatal error during startup', { error: String(err) });
  process.exit(1);
});
