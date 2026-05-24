CREATE TYPE IF NOT EXISTS job_type AS ENUM ('initial', 'reconciliation');
CREATE TYPE IF NOT EXISTS job_status AS ENUM ('running', 'paused', 'done', 'failed');

CREATE TABLE IF NOT EXISTS job_state (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type    job_type NOT NULL UNIQUE,
  status      job_status NOT NULL,
  cursor      JSONB NULL,
  started_at  TIMESTAMP NOT NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT now()
);
