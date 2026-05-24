/**
 * Tests for HTTP error handling in clickup.ts and todoist.ts.
 * Verifies that 429 responses produce RateLimitError with correct retryAfterMs,
 * and that other HTTP errors produce ApiError.
 */

import { RateLimitError, ApiError } from '../services/errors';

// ─── shared axios mock (must start with "mock" to bypass jest.mock hoisting) ──

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();
const mockIsAxiosError = jest.fn();

jest.mock('axios', () => ({
  default: {
    create: jest.fn().mockReturnValue({ get: mockGet, post: mockPost, delete: mockDelete }),
    isAxiosError: mockIsAxiosError,
  },
  create: jest.fn().mockReturnValue({ get: mockGet, post: mockPost, delete: mockDelete }),
  isAxiosError: mockIsAxiosError,
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function makeAxiosError(status: number, headers: Record<string, string>, data: unknown = {}) {
  return { response: { status, headers, data } };
}

// ─── ClickUp client ────────────────────────────────────────────────────────

describe('clickupClient error handling', () => {
  // import after mocks are set up
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { clickupClient } = require('../services/clickup');

  beforeEach(() => {
    mockIsAxiosError.mockReturnValue(true);
  });

  describe('429 → RateLimitError', () => {
    it('calculates retryAfterMs from X-RateLimit-Reset header + 2 min buffer', async () => {
      const resetUnix = Math.floor((Date.now() + 60_000) / 1000); // 1 min from now
      mockGet.mockRejectedValue(
        makeAxiosError(429, { 'x-ratelimit-reset': String(resetUnix) })
      );

      await expect(clickupClient.getTask('cu-1')).rejects.toThrow(RateLimitError);

      try {
        await clickupClient.getTask('cu-1');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        const e = err as RateLimitError;
        expect(e.source).toBe('clickup');
        // 1min (from header) + 2min buffer = ~3min; allow 5s tolerance for test timing
        expect(e.retryAfterMs).toBeGreaterThanOrEqual(3 * 60 * 1000 - 5000);
        expect(e.retryAfterMs).toBeLessThanOrEqual(3 * 60 * 1000 + 5000);
      }
    });

    it('uses 0 as floor when reset timestamp is already in the past', async () => {
      const pastUnix = Math.floor((Date.now() - 60_000) / 1000); // 1 min ago
      mockGet.mockRejectedValue(
        makeAxiosError(429, { 'x-ratelimit-reset': String(pastUnix) })
      );

      try {
        await clickupClient.getTask('cu-1');
      } catch (err) {
        const e = err as RateLimitError;
        // max(0, ...) + 2min buffer
        expect(e.retryAfterMs).toBe(2 * 60 * 1000);
      }
    });
  });

  describe('non-429 HTTP errors → ApiError', () => {
    it('throws ApiError on 500', async () => {
      mockGet.mockRejectedValue(makeAxiosError(500, {}, { err: 'Internal Server Error' }));

      await expect(clickupClient.getTask('cu-1')).rejects.toThrow(ApiError);
    });

    it('throws ApiError on 404', async () => {
      mockGet.mockRejectedValue(makeAxiosError(404, {}, { err: 'Not Found' }));

      try {
        await clickupClient.getTask('cu-1');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const e = err as ApiError;
        expect(e.source).toBe('clickup');
        expect(e.status).toBe(404);
      }
    });

    it('re-throws non-axios errors as-is', async () => {
      mockIsAxiosError.mockReturnValue(false);
      const original = new TypeError('network failure');
      mockGet.mockRejectedValue(original);

      await expect(clickupClient.getTask('cu-1')).rejects.toBe(original);
    });
  });
});

// ─── Todoist client ────────────────────────────────────────────────────────

describe('todoistClient error handling', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { todoistClient } = require('../services/todoist');

  beforeEach(() => {
    mockIsAxiosError.mockReturnValue(true);
  });

  describe('429 → RateLimitError', () => {
    it('calculates retryAfterMs from Retry-After header (seconds) + 2 min buffer', async () => {
      // Retry-After: 60 seconds
      mockGet.mockRejectedValue(makeAxiosError(429, { 'retry-after': '60' }));

      try {
        await todoistClient.getTask('td-1');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        const e = err as RateLimitError;
        expect(e.source).toBe('todoist');
        // 60s + 2min buffer = 3min
        expect(e.retryAfterMs).toBe(60 * 1000 + 2 * 60 * 1000);
      }
    });

    it('falls back to 60s when Retry-After header is absent', async () => {
      mockGet.mockRejectedValue(makeAxiosError(429, {}));

      try {
        await todoistClient.getTask('td-1');
      } catch (err) {
        const e = err as RateLimitError;
        // default 60s + 2min buffer
        expect(e.retryAfterMs).toBe(60 * 1000 + 2 * 60 * 1000);
      }
    });
  });

  describe('non-429 HTTP errors → ApiError', () => {
    it('throws ApiError on 500', async () => {
      mockGet.mockRejectedValue(makeAxiosError(500, {}, { error: 'Service Unavailable' }));

      await expect(todoistClient.getTask('td-1')).rejects.toThrow(ApiError);
    });

    it('includes status code in ApiError', async () => {
      mockGet.mockRejectedValue(makeAxiosError(503, {}, {}));

      try {
        await todoistClient.getTask('td-1');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(503);
      }
    });

    it('re-throws non-axios errors as-is', async () => {
      mockIsAxiosError.mockReturnValue(false);
      const original = new Error('timeout');
      mockGet.mockRejectedValue(original);

      await expect(todoistClient.getTask('td-1')).rejects.toBe(original);
    });
  });
});
