import axios, { AxiosInstance, isAxiosError } from 'axios';
import { config } from '../config';
import { RateLimitError, ApiError } from './errors';

export interface ClickUpStatus {
  status: string;
  type: 'open' | 'closed' | 'custom' | string;
}

export interface ClickUpPriority {
  id: string;
  priority: 'urgent' | 'high' | 'normal' | 'low' | null;
}

export interface ClickUpAssignee {
  id: number;
}

export interface ClickUpList {
  id: string;
  name: string;
}

export interface ClickUpTask {
  id: string;
  name: string;
  status: ClickUpStatus;
  priority: ClickUpPriority | null;
  due_date: string | null; // unix timestamp in ms as string
  url: string;
  list: ClickUpList;
  parent: string | null;
  assignees: ClickUpAssignee[];
}

export interface ClickUpWebhook {
  id: string;
  endpoint: string;
  events: string[];
}

const CLICKUP_BUFFER_MS = 2 * 60 * 1000;

function buildClient(): AxiosInstance {
  return axios.create({
    baseURL: config.CLICKUP_API_URL,
    headers: { Authorization: config.CLICKUP_API_TOKEN },
  });
}

function handleError(err: unknown, source: 'clickup' = 'clickup'): never {
  if (isAxiosError(err) && err.response) {
    const { status, headers, data } = err.response;
    if (status === 429) {
      const reset = Number(headers['x-ratelimit-reset']) * 1000;
      const retryAfterMs = Math.max(reset - Date.now(), 0) + CLICKUP_BUFFER_MS;
      throw new RateLimitError(retryAfterMs, source);
    }
    throw new ApiError(source, status, data?.err ?? data?.error ?? String(status));
  }
  throw err;
}

const http = buildClient();

export const clickupClient = {
  async getTasks(page: number): Promise<{ tasks: ClickUpTask[]; hasMore: boolean }> {
    try {
      const { data } = await http.get<{ tasks: ClickUpTask[] }>(
        `/team/${config.CLICKUP_WORKSPACE_ID}/task`,
        {
          params: {
            assignees: [config.CLICKUP_USER_ID],
            include_closed: false,
            subtasks: true,
            page,
          },
        }
      );
      return { tasks: data.tasks, hasMore: data.tasks.length > 0 };
    } catch (err) {
      handleError(err);
    }
  },

  async getTask(taskId: string): Promise<ClickUpTask> {
    try {
      const { data } = await http.get<ClickUpTask>(`/task/${taskId}`);
      return data;
    } catch (err) {
      handleError(err);
    }
  },

  async listWebhooks(): Promise<ClickUpWebhook[]> {
    try {
      const { data } = await http.get<{ webhooks: ClickUpWebhook[] }>(
        `/team/${config.CLICKUP_WORKSPACE_ID}/webhook`
      );
      return data.webhooks;
    } catch (err) {
      handleError(err);
    }
  },

  async updateWebhook(id: string, events: string[]): Promise<void> {
    try {
      await http.put(`/webhook/${id}`, { events });
    } catch (err) {
      handleError(err);
    }
  },

  async registerWebhook(): Promise<ClickUpWebhook> {
    try {
      const { data } = await http.post<{ webhook: ClickUpWebhook }>(
        `/team/${config.CLICKUP_WORKSPACE_ID}/webhook`,
        {
          endpoint: `${config.PUBLIC_URL}/webhook/clickup`,
          events: [
            'taskCreated',
            'taskUpdated',
            'taskDeleted',
            'taskAssigneeUpdated',
            'taskStatusUpdated',
            'taskPriorityUpdated',
            'taskDueDateUpdated',
            'taskMoved',
          ],
        }
      );
      return data.webhook;
    } catch (err) {
      handleError(err);
    }
  },
};
