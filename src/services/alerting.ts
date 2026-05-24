import { todoistClient } from './todoist';
import { config } from '../config';
import { logger } from '../utils/logger';

export async function createErrorAlert(
  title: string,
  details: string
): Promise<void> {
  try {
    await todoistClient.createTask({
      content: `[TaskSync] ${title}`,
      description: details,
      project_id: config.TODOIST_ERROR_PROJECT_ID,
      labels: ['tasksync-error'],
      priority: 2,
    });
  } catch (err) {
    // alert creation failed — log and move on, don't recurse
    logger.error('Failed to create error alert task in Todoist', { error: String(err) });
  }
}
