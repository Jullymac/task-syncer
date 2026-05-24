# ClickUp API — Notas de Referência

> **Atualizado em:** 2026-05-24
> **Fonte:** documentação oficial fornecida diretamente
> **Versão da API:** v2

---

## Base URL

```
https://api.clickup.com/api/v2
```

## Autenticação

```
Authorization: <CLICKUP_API_TOKEN>
```

Sem prefixo `Bearer` — diferente do Todoist.

---

## GET /team/{team_id}/task — Listar tarefas

Usado em `getTasks(page)` e `getSubtasks(taskId)`.

### Parâmetros relevantes

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `page` | integer | Paginação por número de página, começa em 0 |
| `assignees[]` | string[] | Filtrar por user ID do ClickUp |
| `include_closed` | boolean | Incluir tarefas fechadas (padrão: false) |
| `subtasks` | boolean | Incluir subtarefas (padrão: false) |
| `parent` | string | ID da tarefa pai — retorna subtarefas daquela tarefa |

> ⚠️ Paginação é **por número de página** (0, 1, 2...), não cursor. A página está vazia quando não há mais resultados — não há campo `hasMore` na resposta; o código infere pelo tamanho do array.

### Resposta

```json
{
  "tasks": [ { ...task }, ... ]
}
```

Quando `tasks` é array vazio, não há mais páginas.

---

## GET /task/{task_id} — Buscar tarefa

### Parâmetros opcionais

| Parâmetro | Descrição |
|-----------|-----------|
| `include_subtasks` | Se `true`, inclui array `subtasks` no objeto retornado |

---

## Schema do objeto Task

Campos usados pelo projeto:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | ID da tarefa |
| `name` | string | Título da tarefa |
| `status` | objeto | Ver abaixo |
| `priority` | objeto \| null | Ver abaixo |
| `due_date` | string \| null | Unix timestamp em **milissegundos** como string. Ex: `"1508369194377"` |
| `url` | string | URL da tarefa no app |
| `list` | objeto | `{ id, name, access }` — lista onde a tarefa está |
| `parent` | string \| null | ID da tarefa pai (se for subtarefa) |
| `assignees` | array | Lista de usuários atribuídos |

### Status

```json
{
  "status": "in progress",
  "type": "open",
  "color": "#d3d3d3",
  "orderindex": 1
}
```

| Campo | Descrição |
|-------|-----------|
| `status` | Nome do status (string livre, configurável por workspace) |
| `type` | `"open"`, `"closed"`, `"custom"` — apenas `"closed"` é padronizado |

> ⚠️ Para detectar tarefa concluída, usar `status.type === 'closed'`, não o nome do status.

### Priority

```json
{
  "id": "2",
  "priority": "high",
  "color": "#ffcc00",
  "orderindex": "2"
}
```

| `priority` string | `id` | Descrição |
|-------------------|------|-----------|
| `"urgent"` | `"1"` | P1 — mais urgente |
| `"high"` | `"2"` | P2 |
| `"normal"` | `"3"` | P3 |
| `"low"` | `"4"` | P4 — menos urgente |
| `null` (campo inteiro null) | — | Sem prioridade |

> ⚠️ O campo `priority` pode ser `null` (sem prioridade). Quando presente, o campo `priority.priority` é uma string. Não confundir com o campo numérico `priority` do schema mais antigo da doc (schema v1 da resposta de listagem usa `integer`, mas o exemplo real retorna objeto).

### Assignees

```json
[{ "id": 2772463, "username": "Alex Johnson", "email": "user@company.com", ... }]
```

`assignees[].id` é **integer**.

---

## GET /team/{team_id}/webhook — Listar webhooks

Retorna `{ webhooks: [...] }`. Cada webhook tem:

| Campo | Descrição |
|-------|-----------|
| `id` | UUID do webhook |
| `endpoint` | URL de destino |
| `events` | Array de eventos subscritos |
| `health.status` | `"active"`, `"failing"`, `"suspended"` |
| `health.fail_count` | Contador de falhas |
| `secret` | Segredo HMAC para verificar assinatura |

---

## POST /team/{team_id}/webhook — Criar webhook

### Body

```json
{
  "endpoint": "https://yourdomain.com/webhook",
  "events": ["taskCreated", "taskUpdated", "taskDeleted", "taskStatusUpdated", ...]
}
```

Campos opcionais de escopo (`space_id`, `folder_id`, `list_id`, `task_id`) — omitir para receber eventos de todo o workspace.

### Resposta

```json
{ "id": "<uuid>", "webhook": { ...webhook object } }
```

O `webhook.secret` só é retornado na criação — guardar para verificação de assinatura.

---

## Webhook — Eventos subscritos pelo projeto

| Evento | Quando dispara |
|--------|----------------|
| `taskCreated` | Nova tarefa criada |
| `taskUpdated` | Tarefa atualizada (genérico) |
| `taskDeleted` | Tarefa deletada |
| `taskStatusUpdated` | Status alterado |
| `taskPriorityUpdated` | Prioridade alterada |
| `taskAssigneeUpdated` | Assignee adicionado/removido |
| `taskDueDateUpdated` | Data de vencimento alterada |

> ⚠️ `taskStatusUpdated` e `taskPriorityUpdated` **também** disparam `taskUpdated` no mesmo evento. O projeto pode receber ambos — a lógica de deduplicação deve considerar isso.

> ⚠️ `taskCreated` **também** dispara `taskStatusUpdated`. Ao criar uma tarefa, chegam dois eventos separados.

---

## Webhook — Formato do payload recebido

```json
{
  "event": "taskStatusUpdated",
  "task_id": "1vj38vv",
  "webhook_id": "7fa3ec74-69a8-4530-a251-8a13730bd204",
  "history_items": [
    {
      "id": "2800787326392370170",
      "type": 1,
      "date": "1642736073330",
      "field": "status",
      "parent_id": "162641062",
      "data": { "status_type": "custom" },
      "source": null,
      "user": { "id": 183, "username": "John", ... },
      "before": { "status": "to do", "type": "open", ... },
      "after": { "status": "in progress", "type": "custom", ... }
    }
  ]
}
```

Para `taskDeleted`, o payload é mínimo — sem `history_items`:

```json
{
  "event": "taskDeleted",
  "task_id": "1vj37mc",
  "webhook_id": "7fa3ec74-69a8-4530-a251-8a13730bd204"
}
```

**Campos relevantes:**

| Campo | Descrição |
|-------|-----------|
| `event` | Nome do evento |
| `task_id` | ID da tarefa afetada |
| `webhook_id` | ID do webhook que gerou o evento |
| `history_items[].field` | Campo que mudou: `"status"`, `"priority"`, `"due_date"`, `"assignee_add"`, `"assignee_rem"`, `"task_creation"` |
| `history_items[].before` | Estado anterior |
| `history_items[].after` | Estado posterior |
| `history_items[].user.id` | **integer**, não string |

**Chave de idempotência:** `{{webhook_id}}:{{history_items[x].id}}`

---

## Webhook — Verificação de Assinatura

Cada requisição inclui o header `X-Signature`. Verificar com HMAC-SHA256 usando o `secret` retornado na criação:

```typescript
import crypto from 'crypto';

const hash = crypto.createHmac('sha256', webhookSecret).update(rawBody);
const signature = hash.digest('hex');
// comparar com req.headers['x-signature']
```

> ⚠️ O `rawBody` deve ser a string JSON **sem espaços extras** — não serializar de volta um objeto já parseado.

---

## Webhook — Health e comportamento de falha

| Status | Condição |
|--------|----------|
| `active` | Endpoint responde com 2xx em até 7s |
| `failing` | Resposta não-2xx ou timeout. Retry até 5x por evento, depois incrementa `fail_count` |
| `suspended` | `fail_count` atingiu 100, ou endpoint retornou `401` ou `410` |

- Eventos com falha **não são reenviados** após recovery.
- Retornar `410` suspende o webhook imediatamente.
- Para reativar um webhook suspenso: `PUT /api/v2/webhook/{webhook_id}`.

---

## Rate Limits

Limites por token (pessoal ou OAuth), por minuto:

| Plano | Limite |
|-------|--------|
| Free Forever, Unlimited, Business | 100 req/min |
| Business Plus | 1.000 req/min |
| Enterprise | 10.000 req/min |

**Resposta de rate limit:** HTTP `429 Too Many Requests`

**Headers na resposta de erro:**

| Header | Descrição |
|--------|-----------|
| `X-RateLimit-Limit` | Limite atual do token |
| `X-RateLimit-Remaining` | Requisições restantes na janela atual |
| `X-RateLimit-Reset` | Quando o limite reseta (Unix timestamp em **segundos**) |

O código atual calcula `retryAfterMs` como:
```typescript
const reset = Number(headers['x-ratelimit-reset']) * 1000; // segundos → ms
const retryAfterMs = Math.max(reset - Date.now(), 0) + CLICKUP_BUFFER_MS;
```

---

## Datas e Fusos

- Todos os timestamps retornados pela API estão em **UTC**.
- Formato: **milissegundos** desde Unix epoch, como integer ou string (verificar endpoint específico).
- Tarefas sem horário definido em `due_date` ou `start_date` usam 4h no fuso local do usuário que definiu a data — se o usuário mudar de fuso, as datas **não são atualizadas retroativamente**.

---

## Erros Comuns

Respostas de erro incluem JSON com código e mensagem. HTTP status ≠ 200 indica falha.

| Código de erro | HTTP | Situação |
|----------------|------|----------|
| `OAUTH_017` | 4xx | Header `Authorization` ausente |
| `OAUTH_019`, `OAUTH_021`, `OAUTH_025`, `OAUTH_077` | 4xx | Token revogado ou não encontrado |
| `OAUTH_023`, `OAUTH_026`–`OAUTH_045` | 4xx | Workspace não autorizado para este token |
| `OAUTH_171` | 4xx | **Webhook com essa configuração já existe** |
| — | 429 | Rate limit excedido |

> ⚠️ **`OAUTH_171`** é relevante para o auto-registro de webhook no boot (`src/index.ts`). Se o endpoint e os eventos já estiverem registrados, a API retorna esse erro em vez de criar um duplicado. O código atual verifica se já existe um webhook apontando para `PUBLIC_URL` antes de chamar `registerWebhook` — esse erro pode aparecer em race conditions ou se a verificação falhar.

---

## Notas sobre tipos

- `due_date` na tarefa: string de Unix timestamp em **milissegundos** (ex: `"1508369194377"`), ou `null`
- `assignees[].id`: **integer**
- `history_items[].user.id`: **integer**
- `history_items[].date`: string de Unix timestamp em milissegundos
- Valores de Custom Fields não são normalizados — variam por tipo de campo
- Booleanos não definidos em Custom Fields podem vir como `null` em vez de `false`
