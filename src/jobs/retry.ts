import cron from 'node-cron';
import { pendingEventsRepo, PendingEvent } from '../db/repositories/pendingEvents';
import { registerRetryHandler, rescheduleOrFail, processDueRetries } from '../services/rateLimiter';
import { replayWebhookEvent } from '../webhooks/clickup';
import { taskMappingRepo } from '../db/repositories/taskMapping';
import { clickupClient } from '../services/clickup';
import { createTask, updateTask, completeTask, deleteTask } from '../services/sync';
import { logger } from '../utils/logger';

async function replayJobOperation(event: PendingEvent): Promise<void> {
  const { operation, clickup_task_id } = event;

  if (!clickup_task_id) {
    logger.warn('Job event missing clickup_task_id, skipping', { id: event.id });
    return;
  }

  if (operation === 'delete') {
    const mapping = await taskMappingRepo.findByClickupId(clickup_task_id);
    if (mapping) await deleteTask(mapping);
    return;
  }

  if (operation === 'complete') {
    const mapping = await taskMappingRepo.findByClickupId(clickup_task_id);
    if (mapping) await completeTask(mapping);
    return;
  }

  // create / update — re-fetch current state from ClickUp
  const task = await clickupClient.getTask(clickup_task_id);
  const mapping = await taskMappingRepo.findByClickupId(clickup_task_id);

  if (operation === 'create' && !mapping) {
    await createTask(task);
  } else if (operation === 'update' && mapping) {
    await updateTask(task, mapping);
  }
}

async function handleRetry(event: PendingEvent): Promise<void> {
  await pendingEventsRepo.markProcessing(event.id);
  try {
    if (event.type === 'webhook') {
      await replayWebhookEvent(event.payload);
    } else {
      await replayJobOperation(event);
    }
    await pendingEventsRepo.remove(event.id);
    logger.info('Pending event resolved', { id: event.id, operation: event.operation });
  } catch (err) {
    await rescheduleOrFail(event, err);
  }
}

export function startRetryJob(): void {
  registerRetryHandler(handleRetry);

  // fallback hourly cron — catches events whose setTimeout was lost on restart
  cron.schedule('0 * * * *', async () => {
    logger.info('Retry job: processing due events');
    await processDueRetries();
  });

  logger.info('Retry job scheduled (hourly fallback)');
}
