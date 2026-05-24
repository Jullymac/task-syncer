CREATE TABLE IF NOT EXISTS task_mapping (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clickup_task_id       VARCHAR NOT NULL UNIQUE,
  todoist_task_id       VARCHAR NOT NULL UNIQUE,
  clickup_parent_task_id  VARCHAR NULL,
  todoist_parent_task_id  VARCHAR NULL,
  clickup_list_name     VARCHAR NOT NULL,
  is_assigned_to_me     BOOLEAN NOT NULL DEFAULT true,
  last_synced_at        TIMESTAMP NOT NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT now()
);
