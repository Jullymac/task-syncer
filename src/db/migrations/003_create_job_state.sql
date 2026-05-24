DO $$ BEGIN CREATE TYPE job_type AS ENUM ('initial', 'reconciliation'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE job_status AS ENUM ('running', 'paused', 'done', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS job_state (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type    job_type NOT NULL UNIQUE,
  status      job_status NOT NULL,
  cursor      JSONB NULL,
  started_at  TIMESTAMP NOT NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT now()
);
