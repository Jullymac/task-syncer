# task-syncer

Serviço de sincronização unidirecional ClickUp → Todoist. Monitora as tasks atribuídas ao usuário configurado no workspace do ClickUp e mantém o Todoist atualizado em tempo real via webhooks, com cron jobs periódicos como garantia de consistência.

## Como funciona

- **Webhook** — o ClickUp notifica o serviço a cada evento relevante (criação, atualização, mudança de status, assignee, prioridade, data). O serviço responde com `200` imediatamente e processa em background.
- **Job inicial** — roda uma vez na inicialização, percorre todas as tasks atribuídas via paginação e faz upsert no Todoist. Retoma de onde parou em caso de interrupção (cursor salvo no banco).
- **Reconciliação diária** — cron às 03:00, compara estado do ClickUp com os mapeamentos salvos e corrige divergências.
- **Sistema de retry** — falhas são salvas na tabela `pending_events`. Um cron horário reprocessa eventos pendentes; após 3 tentativas, cria uma task de alerta no Todoist.

### Mapeamento de campos

| ClickUp | Todoist |
|---|---|
| `name` | `content` |
| `url` | `description` |
| `due_date` (unix ms) | `due_date` (YYYY-MM-DD) |
| `priority: urgent` | `priority: 1` |
| `priority: high` | `priority: 2` |
| `priority: normal / null` | `priority: 3` |
| `priority: low` | `priority: 4` |
| `status: open` | label `status: pendente` |
| `status: custom` | label `status: em andamento` |
| `status: closed` | task completada |

Labels gerenciadas pelo sync: `TaskSync`, `reassigned`, `list: *`, `status: *`. Labels adicionadas manualmente pelo usuário são preservadas.

## Configuração

Copie `.env.example` para `.env` e preencha:

```env
CLICKUP_API_TOKEN=        # token de API do ClickUp
CLICKUP_WORKSPACE_ID=     # ID do workspace
CLICKUP_USER_ID=          # ID numérico do usuário a monitorar

TODOIST_API_TOKEN=        # token da API REST do Todoist
TODOIST_SYNC_PROJECT_ID=  # ID do projeto destino no Todoist
TODOIST_SYNC_PROJECT_NAME= # nome do mesmo projeto (usado nos filtros de busca)
TODOIST_ERROR_PROJECT_ID=  # ID do projeto para alertas de falha
TODOIST_ERROR_PROJECT_NAME= # nome do mesmo projeto de alertas

DATABASE_URL=             # postgresql://user:pass@host/db
WEBHOOK_SECRET=           # secret configurado no webhook do ClickUp
PUBLIC_URL=               # URL pública do serviço (ex: https://task-syncer.fly.dev)
PORT=3100                 # opcional, padrão 3100
```

## Desenvolvimento

```bash
npm install
npm run dev          # hot reload via tsx watch
npm test             # todos os testes
npm run lint         # ESLint
```

Para rodar um subset de testes:

```bash
npx jest sync.operations          # por nome de arquivo
npx jest --testNamePattern "429"  # por nome de teste
```

## Deploy

O serviço roda no [Fly.io](https://fly.io) (`task-syncer`, região `gru`).

```bash
npm run build        # compila para dist/
fly deploy
```

O `Dockerfile` usa build em dois estágios e copia as migrations SQL explicitamente (o `tsc` não copia arquivos `.sql`).

O webhook do ClickUp é registrado automaticamente na inicialização se ainda não existir para a `PUBLIC_URL` configurada.
