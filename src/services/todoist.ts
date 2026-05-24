import axios, { AxiosInstance, isAxiosError } from 'axios';
import { config } from '../config';
import { RateLimitError, ApiError } from './errors';

export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  project_id: string;
  parent_id: string | null;
  priority: 1 | 2 | 3 | 4; // 1=urgent → 4=none
  due?: { date: string } | null;
  labels: string[];
}

export interface CreateTodoistTaskInput {
  content: string;
  description?: string;
  project_id: string;
  parent_id?: string | null;
  priority?: 1 | 2 | 3 | 4;
  due_date?: string | null;
  labels?: string[];
}

export interface UpdateTodoistTaskInput {
  content?: string;
  description?: string;
  priority?: 1 | 2 | 3 | 4;
  due_date?: string | null;
  labels?: string[];
}

const TODOIST_BUFFER_MS = 2 * 60 * 1000;

function buildClient(): AxiosInstance {
  return axios.create({
    baseURL: config.TODOIST_API_URL,
    headers: { Authorization: `Bearer ${config.TODOIST_API_TOKEN}` },
  });
}

function handleError(err: unknown, source: 'todoist' = 'todoist'): never {
  if (isAxiosError(err) && err.response) {
    const { status, headers, data } = err.response;
    if (status === 429) {
      const retryAfter = Number(
        headers['retry-after'] ?? data?.retry_after ?? data?.error_extra?.retry_after ?? 60
      );
      const retryAfterMs = retryAfter * 1000 + TODOIST_BUFFER_MS;
      throw new RateLimitError(retryAfterMs, source);
    }
    throw new ApiError(source, status, data?.error ?? String(status));
  }
  throw err;
}

const http = buildClient();

export const todoistClient = {
  async getTask(taskId: string): Promise<TodoistTask> {
    try {
      const { data } = await http.get<TodoistTask>(`/tasks/${taskId}`);
      return data;
    } catch (err) {
      handleError(err);
    }
  },

  async getTasksByProject(projectName: string): Promise<TodoistTask[]> {
    const all: TodoistTask[] = [];
    let cursor: string | null = null;

    do {
      try {
        const params: Record<string, unknown> = { query: `#${projectName}`, limit: 200 };
        if (cursor) params.cursor = cursor;

        const { data } = await http.get<{ results: TodoistTask[]; next_cursor: string | null }>(
          '/tasks/filter',
          { params }
        );
        all.push(...data.results);
        cursor = data.next_cursor;
      } catch (err) {
        handleError(err);
      }
    } while (cursor !== null);

    return all;
  },

  async createTask(input: CreateTodoistTaskInput): Promise<TodoistTask> {
    try {
      const { data } = await http.post<TodoistTask>('/tasks', {
        content: input.content,
        description: input.description ?? '',
        project_id: input.project_id,
        parent_id: input.parent_id ?? undefined,
        priority: input.priority ?? 1,
        due_date: input.due_date ?? undefined,
        labels: input.labels ?? [],
      });
      return data;
    } catch (err) {
      handleError(err);
    }
  },

  async updateTask(taskId: string, input: UpdateTodoistTaskInput): Promise<TodoistTask> {
    try {
      const body: Record<string, unknown> = {};
      if (input.content !== undefined) body.content = input.content;
      if (input.description !== undefined) body.description = input.description;
      if (input.priority !== undefined) body.priority = input.priority;
      if (input.labels !== undefined) body.labels = input.labels;
      // null means remove due date; undefined means don't touch it
      if (input.due_date !== undefined) body.due_date = input.due_date ?? null;

      const { data } = await http.post<TodoistTask>(`/tasks/${taskId}`, body);
      return data;
    } catch (err) {
      handleError(err);
    }
  },

  async completeTask(taskId: string): Promise<void> {
    try {
      await http.post(`/tasks/${taskId}/close`);
    } catch (err) {
      handleError(err);
    }
  },

  async deleteTask(taskId: string): Promise<void> {
    try {
      await http.delete(`/tasks/${taskId}`);
    } catch (err) {
      handleError(err);
    }
  },
};
