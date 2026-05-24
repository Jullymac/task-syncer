# Deploy no Fly.io

## Pré-requisitos

```bash
brew install flyctl
fly auth login
```

## Primeira vez

```bash
# criar a app (usa o nome definido em fly.toml)
fly apps create task-syncer

# criar o banco PostgreSQL (free tier)
fly postgres create --name task-syncer-db --region gru
fly postgres attach task-syncer-db --app task-syncer
# este comando define DATABASE_URL automaticamente como secret

# definir os restantes secrets
fly secrets set \
  CLICKUP_API_TOKEN=... \
  CLICKUP_WORKSPACE_ID=... \
  CLICKUP_USER_ID=... \
  TODOIST_API_TOKEN=... \
  TODOIST_SYNC_PROJECT_ID=... \
  TODOIST_ERROR_PROJECT_ID=... \
  WEBHOOK_SECRET=... \
  PUBLIC_URL=https://task-syncer.fly.dev \
  --app task-syncer

# deploy
fly deploy --app task-syncer
```

## Deploys seguintes

```bash
fly deploy --app task-syncer
```

## Logs

```bash
fly logs --app task-syncer
```

## Notas

- O job inicial corre automaticamente no startup se não houver registo `done` em `job_state`.
- O webhook é registado no ClickUp automaticamente no startup.
- `auto_stop_machines = "stop"` mantém a máquina activa enquanto há tráfego.
  Se a máquina adormecer e houver um webhook, o Fly.io acorda-a automaticamente (`auto_start_machines = true`).
  Contudo, os `setTimeout` de retry perdem-se num sleep — o cron horário de fallback recupera-os.
