import { pendingEventsRepo, PendingEvent, CreatePendingEventInput } from '../db/repositories/pendingEvents';
import { RateLimitError } from './errors';
import { createErrorAlert } from './alerting';
import { logger } from '../utils/logger';

const MAX_ATTEMPTS = 3;

type RetryHandler = (event: PendingEvent) => Promise<void>;
let retryHandler: RetryHandler | null = null;

export function registerRetryHandler(handler: RetryHandler): void {
  retryHandler = handler;
}

function backoffMs(attempts: number): number {
  // 1min → 2min → 4min
  return Math.pow(2, attempts) * 60 * 1000;
}

function scheduleTimeout(event: PendingEvent, delayMs: number): void {
  setTimeout(async () => {
    if (!retryHandler) return;
    const due = await pendingEventsRepo.findDueForRetry();
    const target = due.find((e) => e.id === event.id);
    if (!target) return; // already processed or removed
    await retryHandler(target);
  }, delayMs);
}

export async function saveForRetry(
  input: CreatePendingEventInput,
  err: unknown
): Promise<void> {
  let nextRetryAt: Date;
  let delayMs: number;

  if (err instanceof RateLimitError) {
    delayMs = err.retryAfterMs;
    nextRetryAt = new Date(Date.now() + delayMs);
    logger.warn('Rate limited, saving for retry', {
      source: err.source,
      retryAt: nextRetryAt,
    });
  } else {
    delayMs = backoffMs(0);
    nextRetryAt = new Date(Date.now() + delayMs);
    logger.warn('Operation failed, saving for retry', {
      error: String(err),
      retryAt: nextRetryAt,
    });
  }

  const event = await pendingEventsRepo.create({ ...input, next_retry_at: nextRetryAt });
  scheduleTimeout(event, delayMs);
}

export async function rescheduleOrFail(
  event: PendingEvent,
  err: unknown
): Promise<void> {
  const attempts = event.attempts + 1;
  const errorLog = String(err);

  if (attempts >= MAX_ATTEMPTS) {
    await pendingEventsRepo.markFailed(event.id, errorLog);
    logger.error('Pending event permanently failed', {
      id: event.id,
      operation: event.operation,
      clickup_task_id: event.clickup_task_id,
    });
    await createErrorAlert(
      `Falha ao executar operação: ${event.operation}`,
      [
        `Operação: ${event.operation}`,
        `Tipo: ${event.type}`,
        `Task ClickUp: ${event.clickup_task_id ?? 'N/A'}`,
        `Tentativas: ${attempts}`,
        `Último erro: ${errorLog}`,
        `Payload: ${JSON.stringify(event.payload)}`,
      ].join('\n')
    );
    return;
  }

  let delayMs: number;
  let nextRetryAt: Date;

  if (err instanceof RateLimitError) {
    delayMs = err.retryAfterMs;
    nextRetryAt = new Date(Date.now() + delayMs);
  } else {
    delayMs = backoffMs(attempts);
    nextRetryAt = new Date(Date.now() + delayMs);
  }

  await pendingEventsRepo.scheduleRetry(event.id, nextRetryAt, errorLog);
  scheduleTimeout(event, delayMs);

  logger.warn('Pending event rescheduled', {
    id: event.id,
    attempts,
    retryAt: nextRetryAt,
  });
}

export async function processDueRetries(): Promise<void> {
  if (!retryHandler) {
    logger.warn('processDueRetries called but no retryHandler registered');
    return;
  }
  const due = await pendingEventsRepo.findDueForRetry();
  if (due.length === 0) return;

  logger.info(`Processing ${due.length} due retry event(s)`);
  await Promise.allSettled(due.map((event) => retryHandler!(event)));
}
