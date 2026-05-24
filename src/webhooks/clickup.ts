import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { clickupClient, ClickUpTask } from '../services/clickup';
import { taskMappingRepo } from '../db/repositories/taskMapping';
import { saveForRetry } from '../services/rateLimiter';
import {
  isAssignedToUser,
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  handleReassigned,
  handleReassignedBack,
} from '../services/sync';
import { logger } from '../utils/logger';

export const webhookRouter = Router();

// ---------------------------------------------------------------------------
// Signature validation
// ---------------------------------------------------------------------------

export function validateSignature(rawBody: Buffer, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', config.WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

// ---------------------------------------------------------------------------
// Event processing
// ---------------------------------------------------------------------------

type WebhookEvent =
  | 'taskCreated'
  | 'taskUpdated'
  | 'taskDeleted'
  | 'taskAssigneeUpdated'
  | 'taskStatusUpdated'
  | 'taskPriorityUpdated'
  | 'taskDueDateUpdated';

interface WebhookPayload {
  event: WebhookEvent;
  task_id: string;
}

async function processEvent(payload: WebhookPayload): Promise<void> {
  const { event, task_id } = payload;
  const mapping = await taskMappingRepo.findByClickupId(task_id);

  if (event === 'taskDeleted') {
    if (mapping) await deleteTask(mapping);
    return;
  }

  const task = await clickupClient.getTask(task_id);

  switch (event) {
    case 'taskCreated': {
      if (!mapping && isAssignedToUser(task)) {
        await createTask(task);
      }
      break;
    }

    case 'taskStatusUpdated': {
      if (!mapping) break;
      if (task.status.type === 'closed') {
        await completeTask(mapping);
      } else {
        await updateTask(task, mapping);
      }
      break;
    }

    case 'taskAssigneeUpdated': {
      await handleAssigneeUpdate(task, mapping);
      break;
    }

    case 'taskUpdated':
    case 'taskPriorityUpdated':
    case 'taskDueDateUpdated': {
      if (mapping) {
        await updateTask(task, mapping);
      } else if (isAssignedToUser(task)) {
        await createTask(task);
      }
      break;
    }
  }
}

async function handleAssigneeUpdate(
  task: ClickUpTask,
  mapping: Awaited<ReturnType<typeof taskMappingRepo.findByClickupId>>
): Promise<void> {
  const assignedToMe = isAssignedToUser(task);

  if (!mapping) {
    if (assignedToMe) await createTask(task);
    return;
  }

  if (assignedToMe && !mapping.is_assigned_to_me) {
    await handleReassignedBack(task, mapping);
  } else if (!assignedToMe && mapping.is_assigned_to_me) {
    await handleReassigned(mapping);
  }
}

// ---------------------------------------------------------------------------
// Retry handler — called by rateLimiter when replaying a pending event
// ---------------------------------------------------------------------------

export async function replayWebhookEvent(
  payload: Record<string, unknown>
): Promise<void> {
  await processEvent(payload as unknown as WebhookPayload);
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

webhookRouter.post(
  '/clickup',
  // use raw body so we can validate the HMAC signature
  (req, res, next) => {
    let data = Buffer.alloc(0);
    req.on('data', (chunk: Buffer) => { data = Buffer.concat([data, chunk]); });
    req.on('end', () => {
      (req as Request & { rawBody: Buffer }).rawBody = data;
      try {
        req.body = JSON.parse(data.toString());
      } catch {
        res.status(400).json({ error: 'Invalid JSON' });
        return;
      }
      next();
    });
  },

  async (req: Request & { rawBody?: Buffer }, res: Response) => {
    const signature = req.headers['x-signature'] as string | undefined;

    if (!signature || !req.rawBody || !validateSignature(req.rawBody, signature)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // respond immediately — ClickUp expects a fast 200
    res.sendStatus(200);

    const payload = req.body as WebhookPayload;

    try {
      await processEvent(payload);
    } catch (err) {
      logger.error('Webhook processing failed, saving for retry', {
        event: payload.event,
        task_id: payload.task_id,
        error: String(err),
      });

      await saveForRetry(
        {
          type: 'webhook',
          operation: resolveOperation(payload.event),
          payload: payload as unknown as Record<string, unknown>,
          clickup_task_id: payload.task_id,
          next_retry_at: new Date(),
        },
        err
      );
    }
  }
);

function resolveOperation(event: WebhookEvent): 'create' | 'update' | 'complete' | 'delete' {
  if (event === 'taskCreated') return 'create';
  if (event === 'taskDeleted') return 'delete';
  if (event === 'taskStatusUpdated') return 'update'; // could be complete, re-evaluated on retry
  return 'update';
}
