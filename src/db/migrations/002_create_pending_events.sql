DO $$ BEGIN CREATE TYPE pending_event_type AS ENUM ('webhook', 'job_initial', 'job_reconciliation'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE pending_event_operation AS ENUM ('create', 'update', 'complete', 'delete'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE pending_event_status AS ENUM ('pending', 'processing', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pending_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             pending_event_type NOT NULL,
  operation        pending_event_operation NOT NULL,
  status           pending_event_status NOT NULL DEFAULT 'pending',
  payload          JSONB NOT NULL,
  clickup_task_id  VARCHAR NULL,
  attempts         INT NOT NULL DEFAULT 0,
  next_retry_at    TIMESTAMP NOT NULL,
  error_log        TEXT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_events_retry
  ON pending_events (status, next_retry_at)
  WHERE status = 'pending';
