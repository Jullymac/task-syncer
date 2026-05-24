import { jobStateRepo } from '../db/repositories/jobState';
import { clickupClient } from '../services/clickup';
import { todoistClient } from '../services/todoist';
import { upsertFromClickUp, isAssignedToUser } from '../services/sync';
import { saveForRetry } from '../services/rateLimiter';
import { RateLimitError } from '../services/errors';
import { config } from '../config';
import { logger } from '../utils/logger';

interface InitialCursor {
  page: number;
}

export async function runInitialJob(): Promise<void> {
  const state = await jobStateRepo.find('initial');

  if (state?.status === 'done') {
    logger.info('Initial job already completed, skipping');
    return;
  }

  const startPage = (state?.cursor as InitialCursor | null)?.page ?? 0;

  if (startPage === 0) {
    logger.info('Starting initial sync job');
    await jobStateRepo.upsertRunning('initial');
  } else {
    logger.info(`Resuming initial sync job from page ${startPage}`);
  }

  // fetch Todoist tasks once for DB-recovery matching
  const existingTodoistTasks = await todoistClient.getTasksByProject(
    config.TODOIST_SYNC_PROJECT_NAME
  );

  // track which top-level task IDs are assigned to the user,
  // so we can include their unassigned subtasks
  const assignedParentIds = new Set<string>();
  const unassignedSubtaskBuffer: Parameters<typeof upsertFromClickUp>[0][] = [];

  let page = startPage;

  try {
    while (true) {
      const { tasks, hasMore } = await clickupClient.getTasks(page);

      if (!hasMore) break;

      for (const task of tasks) {
        if (isAssignedToUser(task)) {
          if (!task.parent) assignedParentIds.add(task.id);
          await upsertFromClickUp(task, existingTodoistTasks);
        } else if (task.parent && task.assignees.length === 0) {
          // buffer unassigned subtasks — evaluate after parents are processed
          unassignedSubtaskBuffer.push(task);
        }
      }

      page += 1;
      await jobStateRepo.saveCursor('initial', { page });
      logger.info(`Initial job: page ${page} processed`);
    }

    // process unassigned subtasks whose parent was assigned to the user
    for (const subtask of unassignedSubtaskBuffer) {
      if (subtask.parent && assignedParentIds.has(subtask.parent)) {
        await upsertFromClickUp(subtask, existingTodoistTasks);
      }
    }

    await jobStateRepo.markDone('initial');
    logger.info('Initial sync job completed');
  } catch (err) {
    if (err instanceof RateLimitError) {
      await jobStateRepo.saveCursor('initial', { page });
      logger.warn('Initial job paused due to rate limit', {
        retryAfterMs: err.retryAfterMs,
        page,
      });
      setTimeout(() => runInitialJob(), err.retryAfterMs);
    } else {
      await jobStateRepo.markFailed('initial');
      logger.error('Initial job failed', { error: String(err), page });

      await saveForRetry(
        {
          type: 'job_initial',
          operation: 'create',
          payload: { page },
          next_retry_at: new Date(),
        },
        err
      );
    }
  }
}
