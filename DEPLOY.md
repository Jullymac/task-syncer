# Deploy no Heroku

## Pré-requisitos

```bash
brew install heroku
heroku login
```

## Primeira vez

```bash
# criar a app
heroku create task-syncer

# adicionar PostgreSQL (plano Essential 0 — ~5 USD/mês, 1 GB)
heroku addons:create heroku-postgresql:essential-0 --app task-syncer
# DATABASE_URL é definido automaticamente como variável de ambiente

# definir os restantes secrets
heroku config:set \
  CLICKUP_API_TOKEN=... \
  CLICKUP_WORKSPACE_ID=... \
  CLICKUP_USER_ID=... \
  TODOIST_API_TOKEN=... \
  TODOIST_SYNC_PROJECT_ID=... \
  TODOIST_ERROR_PROJECT_ID=... \
  WEBHOOK_SECRET=... \
  PUBLIC_URL=https://task-syncer-215967f4ddde.herokuapp.com \
  --app task-syncer

# conectar ao repositório git remoto
heroku git:remote --app task-syncer

# deploy
git push heroku main
```

## Deploys seguintes

```bash
git push heroku main
```

## Logs

```bash
heroku logs --tail --app task-syncer
```

## Notas

- O buildpack Node.js do Heroku corre `npm run build` automaticamente antes de iniciar a app.
- A porta é injectada pelo Heroku via a variável `PORT` — o `config.ts` já lê essa variável.
- O job inicial corre automaticamente no startup se não houver registo `done` em `job_state`.
- O webhook é registado no ClickUp automaticamente no startup.
- No plano gratuito (eco dynos), a máquina pode adormecer — considere um plano Basic (~7 USD/mês) para manter o dyno sempre activo, caso contrário os `setTimeout` de retry perdem-se e dependem do cron horário de fallback para recuperar.
