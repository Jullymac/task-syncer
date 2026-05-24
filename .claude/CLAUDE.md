# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ClickUp → Todoist unidirectional sync service. Monitors tasks assigned to the configured user in a ClickUp workspace and keeps Todoist updated via webhooks, with periodic cron jobs for resilience.

## Commands

```bash
# Development
npm run dev          # tsx watch (hot reload)
npm run build        # tsc compile to dist/
npm run start        # node dist/index.js

# Quality
npm run lint         # ESLint
npm run lint:fix     # ESLint with auto-fix

# Tests
npm test                                      # all tests
npm run test:watch                            # watch mode
npm run test:coverage                         # with coverage report
npx jest sync.operations                      # single file by name pattern
npx jest --testNamePattern "429"              # filter by test name
```

## Architecture

### Startup Sequence (`src/index.ts`)

1. Validate all env vars via Zod (exits immediately on failure)
2. Connect to PostgreSQL and run pending SQL migrations
3. Register the ClickUp webhook (checks for existing before creating)
4. Register retry handler + start cron jobs (must happen before initial job)
5. Run initial sync job (resumes from cursor if previously interrupted)
6. Start Express — `/webhook` router is mounted **before** `express.json()` because it handles its own raw body parsing for HMAC validation

### Database

SQL migrations in `src/db/migrations/` are applied at startup by `src/db/migrate.ts`, which tracks applied files in the `db_migrations` table. All table names are defined as constants in `src/db/tables.ts` — use `TABLES.*` everywhere, never hardcode table name strings.

Three tables: `task_mapping` (ClickUp↔Todoist ID pairs), `pending_events` (retry queue), `job_state` (pagination cursor for resumable jobs).

### Sync Logic (`src/services/sync.ts`)

Label management is the most critical invariant: **`computeLabels` never touches labels not owned by the sync** (only `TaskSync`, `reassigned`, `list: *`, `status: *`). Always fetch the current Todoist task before updating labels.

Field mapping:
- Priority: `urgent→1, high→2, normal→3, low→4, null→3` (1=highest in Todoist REST API; null = no priority set → defaults to normal)
- Status: `open→"status: pendente"`, custom→`"status: em andamento"`, `closed→null` (remove label + complete)
- Due date: ClickUp unix-ms string → `YYYY-MM-DD`

`upsertFromClickUp` doubles as DB-recovery: when no mapping exists, it searches existing Todoist tasks by `content === task.name && labels.includes('TaskSync')` before creating a new one.

### Error Handling & Retry

`src/services/errors.ts` defines `RateLimitError(retryAfterMs, source)` and `ApiError`. Both API clients translate HTTP errors into these types:
- ClickUp 429: `Math.max(X-RateLimit-Reset * 1000 - Date.now(), 0) + 2min buffer`
- Todoist 429: `Retry-After * 1000 + 2min buffer` (defaults to 60s if header absent)

`src/services/rateLimiter.ts` manages persistence: `saveForRetry` (first failure, 1min delay) and `rescheduleOrFail` (subsequent failures, `2^attempts * 60s`; after 3 attempts → `markFailed` + Todoist alert task). The retry handler is registered at startup via `registerRetryHandler` — this avoids circular module dependencies.

### Webhook (`src/webhooks/clickup.ts`)

- `validateSignature` — HMAC-SHA256 with length check before `timingSafeEqual`
- `replayWebhookEvent` — used by the retry job to reprocess failed webhook events
- `taskDeleted` is the only event that skips the ClickUp API fetch (only needs the mapping)
- Express responds `200` before `processEvent` is awaited

### Jobs

- **Initial** (`src/jobs/initial.ts`): Runs once on startup. Paginates all assigned tasks. Buffers unassigned subtasks and validates parent eligibility after all pages. Saves cursor to `job_state` on every page so it can resume after restart or rate limit.
- **Reconciliation** (`src/jobs/reconciliation.ts`): Daily at 03:00. Fetches ClickUp tasks + DB mappings + Todoist tasks in parallel. Creates missing, removes stale, updates divergent.
- **Retry** (`src/jobs/retry.ts`): Runs hourly as fallback for events whose `setTimeout` was lost on process restart. Also the source of `registerRetryHandler`.

### Deployment

`tsc` does not copy `.sql` files. The `Dockerfile` explicitly copies them in the runtime stage:
```dockerfile
COPY src/db/migrations ./dist/db/migrations
```

Fly.io app: `task-syncer`, region `gru` (São Paulo), internal port `3100`.

## Tests

Test files live in `src/__tests__/`. `src/__tests__/setup.ts` sets all required env vars before any module loads — this prevents `config.ts` from calling `process.exit(1)` during tests.

Mocking conventions:
- Always mock `../utils/logger` to silence output
- Axios mock variables must be prefixed with `mock` (Jest hoisting exception) and defined before `jest.mock('axios', ...)`
- Use `jest.Mocked<typeof x>` casts on mocked module exports for typed mock access
