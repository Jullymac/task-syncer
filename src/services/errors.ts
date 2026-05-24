export class RateLimitError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    public readonly source: 'clickup' | 'todoist'
  ) {
    super(`Rate limited by ${source}, retry after ${retryAfterMs}ms`);
    this.name = 'RateLimitError';
  }
}

export class ApiError extends Error {
  constructor(
    public readonly source: 'clickup' | 'todoist',
    public readonly status: number,
    message: string
  ) {
    super(`${source} API error ${status}: ${message}`);
    this.name = 'ApiError';
  }
}
