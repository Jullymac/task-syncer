import cron from 'node-cron';
import { jobStateRepo } from '../db/repositories/jobState';
import { taskMappingRepo } from '../db/repositories/taskMapping';
import { clickupClient, ClickUpTask } from '../services/clickup';
import { todoistClient } from '../services/todoist';
import { upsertFromClickUp, isAssignedToUser, deleteTask } from '../services/sync';
import { saveForRetry } from '../services/rateLimiter';
import { RateLimitError } from '../services/errors';
import { config } from '../config';
import { logger } from '../utils/logger';

async function fetchAllEligibleTasks(): Promise<ClickUpTask[]> {
  const allTasks: ClickUpTask[] = [];
  const assignedParentIds = new Set<string>();
  const unassignedSubtasks: ClickUpTask[] = [];
  let page = 0;

  while (true) {
    const { tasks, hasMore } = await clickupClient.getTasks(page);
    if (!hasMore) break;

    for (const task of tasks) {
      if (isAssignedToUser(task)) {
        allTasks.push(task);
        if (!task.parent) assignedParentIds.add(task.id);
      } else if (task.parent && task.assignees.length === 0) {
        unassignedSubtasks.push(task);
      }
    }
    page += 1;
  }

  for (const subtask of unassignedSubtasks) {
    if (subtask.parent && assignedParentIds.has(subtask.parent)) {
      allTasks.push(subtask);
    }
  }

  return allTasks;
}

async function runReconciliation(): Promise<void> {
  logger.info('Reconciliation job started');
  await jobStateRepo.upsertRunning('reconciliation');

  try {
    const [clickupTasks, allMappings, existingTodoistTasks] = await Promise.all([
      fetchAllEligibleTasks(),
      taskMappingRepo.findAll(),
      todoistClient.getTasksByProject(config.TODOIST_SYNC_PROJECT_NAME),
    ]);

    const clickupIds = new Set(clickupTasks.map((t) => t.id));
    const mappingIds = new Set(allMappings.map((m) => m.clickup_task_id));

    // tasks in ClickUp but not in mapping → create/update
    for (const task of clickupTasks) {
      await upsertFromClickUp(task, existingTodoistTasks);
    }

    // tasks in mapping but no longer in ClickUp → remove
    for (const mapping of allMappings) {
      if (!clickupIds.has(mapping.clickup_task_id)) {
        logger.info('Reconciliation: removing stale task', {
          clickup_id: mapping.clickup_task_id,
        });
        await deleteTask(mapping);
      }
    }

    await jobStateRepo.markDone('reconciliation');
    logger.info('Reconciliation job completed', {
      clickupCount: clickupIds.size,
      mappingCount: mappingIds.size,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      await jobStateRepo.saveCursor('reconciliation', { page: 0 });
      logger.warn('Reconciliation job paused due to rate limit', {
        retryAfterMs: err.retryAfterMs,
      });
      setTimeout(() => runReconciliation(), err.retryAfterMs);
    } else {
      await jobStateRepo.markFailed('reconciliation');
      logger.error('Reconciliation job failed', { error: String(err) });

      await saveForRetry(
        {
          type: 'job_reconciliation',
          operation: 'update',
          payload: {},
          next_retry_at: new Date(),
        },
        err
      );
    }
  }
}

export function startReconciliationJob(): void {
  cron.schedule('0 3 * * *', () => {
    runReconciliation().catch((err) =>
      logger.error('Unhandled error in reconciliation job', { error: String(err) })
    );
  });

  logger.info('Reconciliation job scheduled (daily at 03:00)');
}
