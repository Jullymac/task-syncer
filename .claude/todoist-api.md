# Todoist API — Notas de Referência

> **Atualizado em:** 2026-05-24
> **Fonte:** documentação oficial fornecida diretamente (https://developer.todoist.com/api/v1/)
> **Versão da API:** v1

---

## Base URLs

| API | URL |
|-----|-----|
| REST | `https://api.todoist.com/api/v1` |
| Sync | `https://api.todoist.com/api/v1/sync` |

> ⚠️ A URL `https://api.todoist.com/rest/v2` está **desatualizada** — não usar.

---

## Autenticação

```
Authorization: Bearer <TODOIST_API_TOKEN>
```

Válido para REST e Sync.

---

## Paginação (REST)

Endpoints de listagem usam **cursor-based pagination** — sem page numbers ou offsets.

### Formato da resposta paginada

```json
{
  "results": [ { "id": "abc123", "content": "Task 1" }, ... ],
  "next_cursor": "eyJwYWdlIjoyLCJsaW1pdCI6NTB9.aGFzaA"
}
```

Quando `next_cursor` é `null`, não há mais resultados.

### Parâmetros

| Parâmetro | Default | Máximo | Descrição |
|-----------|---------|--------|-----------|
| `limit` | 50 | 200 | Itens por página. Acima de 200 retorna erro de validação |
| `cursor` | — | — | Token opaco da resposta anterior (`next_cursor`) |

### Regras

- Sempre usar os **mesmos parâmetros de filtro** em todas as páginas de uma sessão — mudar parâmetros com cursor ativo causa comportamento imprevisível
- **Não persistir cursors** em banco de dados — são para uso imediato em sessões de paginação
- Dados podem mudar enquanto pagina (itens adicionados/removidos por outros clientes) — implementar deduplicação se consistência for crítica
- Paginar até `next_cursor === null`, ou parar cedo se já encontrou o que precisava

---

## REST API — Endpoints de Tarefa

### GET /tasks/filter — Listar tarefas por filtro

```
GET /tasks/filter?query=<filtro>&limit=50&cursor=<cursor>
```

| Parâmetro | Obrigatório | Descrição |
|-----------|-------------|-----------|
| `query` | sim | Filtro no formato Todoist. 1–1024 chars |
| `lang` | não | Código de idioma do filtro (padrão: `en`) |
| `limit` | não | Itens por página (padrão 50, máx 200) |
| `cursor` | não | Token da página anterior |

**Exemplos de query:**
- `#NomeDoProjeto` — tarefas do projeto
- `##NomeDoProjeto` — tarefas do projeto e subprojetos
- `@label` — tarefas com a label
- `#Projeto & !#SubProjeto` — combinando filtros

Resposta paginada: `{ results: [...], next_cursor: ... }`

> ⚠️ Este é o endpoint correto para listar por projeto — não `GET /tasks?project_id=...`.
> A implementação atual usa `getTasksByProject` — verificar se está chamando o endpoint certo.

---

### GET /tasks/{task_id} — Buscar tarefa

```
GET /tasks/{task_id}
```

Resposta (campos relevantes):

```json
{
  "id": "6XGgmFVcrG5RRjVr",
  "content": "Buy milk",
  "description": "Pick up organic milk",
  "project_id": "6XGgm6PHrGgMpCFX",
  "parent_id": "6XGgmFVcrG5RRjVr",
  "labels": ["priority"],
  "priority": 1,
  "due": {
    "date": "2025-02-12",
    "is_recurring": false,
    "lang": "en",
    "string": "tomorrow"
  },
  "checked": false,
  "is_deleted": false
}
```

---

### POST /tasks — Criar tarefa

```
POST /tasks
Content-Type: application/json
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `content` | string | **sim** | Título da tarefa |
| `description` | string | não | Descrição (suporta markdown) |
| `project_id` | string | não | ID do projeto. Sem valor → Inbox |
| `parent_id` | string | não | ID da tarefa pai (subtarefa) |
| `labels` | string[] | não | Array de **nomes** de labels |
| `priority` | 1–4 | não | Ver seção de prioridade abaixo |
| `due_date` | string | não | Data no formato RFC 3339 ou `YYYY-MM-DD` |
| `due_string` | string | não | Linguagem natural: "tomorrow", "every day" |
| `due_datetime` | string | não | Data e hora |
| `deadline_date` | string | não | Formato `YYYY-MM-DD` |

Retorna o objeto da tarefa criada (mesmo schema do GET).

---

### POST /tasks/{task_id} — Atualizar tarefa

```
POST /tasks/{task_id}
Content-Type: application/json
```

Mesmos campos do create, todos opcionais. Campos omitidos **não são alterados**. Para limpar um campo, enviar `null` (onde suportado).

Retorna o objeto da tarefa atualizada.

---

### POST /tasks/{task_id}/close — Completar tarefa

```
POST /tasks/{task_id}/close
```

Comportamento idêntico ao cliente oficial:
- Tarefas regulares → marcadas como completas e movidas para histórico (incluindo subtarefas)
- Tarefas recorrentes → agendadas para a próxima ocorrência

Retorna `null`.

---

### DELETE /tasks/{task_id} — Deletar tarefa

```
DELETE /tasks/{task_id}
```

Deleta a tarefa e todas as suas subtarefas.

Erros: `NOT_FOUND` se não existir, `FORBIDDEN` se sem permissão.

Retorna `null`.

---

## ⚠️ Escala de Prioridade

A prioridade é **invertida** entre o que o cliente mostra e o que a API retorna:

| UI Todoist | Valor na API (Sync) | Valor na API (REST) |
|------------|---------------------|---------------------|
| P1 (urgente) | 4 | ❓ doc diz "1 é o mais alto" |
| P2 (alto) | 3 | 2 |
| P3 (normal) | 2 | 3 |
| P4 / nenhuma | 1 | 4 |

**Sync API** (confirmado pela doc): `4 = muito urgente`, `1 = natural`. A nota diz: *"p1 will return 4 in the API"*.

**REST API** (doc diz): `"priority (1-4, where 1 is highest)"` — o que contradiz o Sync.

> ⚠️ **Inconsistência na documentação.** O mapeamento atual no código (`urgent→4, high→3, normal→2, none→1`) está alinhado com o Sync API. Verificar empiricamente o comportamento do REST antes de implementar batch via Sync.

---

## Sync API

Endpoint: **POST** `https://api.todoist.com/api/v1/sync`

`Content-Type: application/x-www-form-urlencoded`

---

### Leitura de recursos

```bash
curl https://api.todoist.com/api/v1/sync \
  -H "Authorization: Bearer <token>" \
  -d sync_token='*' \
  -d resource_types='["items"]'
```

| Parâmetro | Obrigatório | Descrição |
|-----------|-------------|-----------|
| `sync_token` | sim | `*` para sync completo; token retornado anteriormente para sync incremental |
| `resource_types` | sim | Array JSON de tipos de recurso. Ex: `["items"]`, `["items", "labels"]`, `["all"]` |

**Tipos de recurso disponíveis:** `labels`, `projects`, `items`, `notes`, `sections`, `filters`, `reminders`, `locations`, `user`, `collaborators`, `user_settings`, `user_plan_limits`, `stats`, `workspaces`, `workspace_users` (só incremental), `view_options`, `role_actions`, entre outros. Prefixar com `-` para excluir: `["-projects"]`.

**Campos da resposta de leitura:**

| Campo | Descrição |
|-------|-----------|
| `sync_token` | Novo token para o próximo sync incremental |
| `full_sync` | `true` = dados completos, `false` = apenas atualizações desde o último token |
| `full_sync_date_utc` | Quando os dados foram gerados (relevante para contas grandes com delay) |
| `items` | Array de tarefas |
| `projects` | Array de projetos |
| `labels` | Array de labels |

---

### Sync incremental

1. Primeira requisição: `sync_token=*` → recebe todos os dados + novo `sync_token`
2. Requisições seguintes: usa o `sync_token` retornado → recebe apenas o que mudou

**Limites de rate:** incrementais têm limite 10x maior (1.000/15min vs 100/15min para full). Usar full sync **apenas na primeira requisição**.

**Caveat para contas grandes:** o sync inicial pode ter delay. Se `full_sync_date_utc` estiver defasado, fazer um incremental imediato com o token retornado para obter os dados mais recentes.

---

### Escrita em batch — estrutura do comando

```json
{
  "type": "item_add",
  "uuid": "997d4b43-55f1-48a9-9e66-de5785dfd69b",
  "temp_id": "43f7ed23-a038-46b5-b2c9-4abda9097ffa",
  "args": { ... }
}
```

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `type` | sim | Tipo do comando |
| `uuid` | sim | UUID único por comando — idempotência + mapeamento de resultado |
| `temp_id` | não | Só em comandos de criação. Permite referenciar o recurso em outros comandos do mesmo batch antes de ter o ID real |
| `args` | sim | Parâmetros do comando |

**Idempotência:** reenviar o mesmo `uuid` não re-executa o comando.

**Encadeamento com `temp_id`:** um `item_add` pode usar o `temp_id` de um `project_add` anterior no mesmo batch como `project_id` — o servidor resolve automaticamente.

---

### item_add — Criar tarefa

```json
{
  "type": "item_add",
  "temp_id": "<uuid>",
  "uuid": "<uuid>",
  "args": {
    "content": "Buy Milk",
    "project_id": "6Jf8VQXxpwv56VQ7",
    "labels": ["Food", "Shopping"],
    "priority": 4,
    "due": { "date": "2026-06-01" },
    "parent_id": null,
    "description": "Optional description"
  }
}
```

| Argumento | Obrigatório | Descrição |
|-----------|-------------|-----------|
| `content` | **sim** | Texto da tarefa |
| `description` | não | Descrição |
| `project_id` | não | ID do projeto (ou `temp_id` de projeto criado no mesmo batch). Padrão: Inbox |
| `parent_id` | não | ID da tarefa pai |
| `labels` | não | Array de nomes de labels |
| `priority` | não | 4 = urgente, 1 = natural |
| `due` | não | Objeto `{date: "YYYY-MM-DD"}` ou `{string: "tomorrow"}` |
| `section_id` | não | ID da seção |

> ⚠️ No Sync API, `due` é um **objeto**, não uma string. Diferente do REST que usa `due_date: "YYYY-MM-DD"`.

---

### item_update — Atualizar tarefa

```json
{
  "type": "item_update",
  "uuid": "<uuid>",
  "args": {
    "id": "6X7rM8997g3RQmvh",
    "content": "Buy Coffee",
    "due": { "string": "tomorrow at 10:00" },
    "labels": ["Food"],
    "priority": 3
  }
}
```

| Argumento | Obrigatório | Descrição |
|-----------|-------------|-----------|
| `id` | **sim** | ID da tarefa |
| `content` | não | Texto atualizado |
| `description` | não | Descrição atualizada |
| `labels` | não | Lista completa de labels (substitui, não adiciona) |
| `priority` | não | 4 = urgente, 1 = natural |
| `due` | não | Objeto `{date: "YYYY-MM-DD"}` ou `{string: "..."}` |

> `item_update` **não suporta** mover tarefa para outro pai, completar ou descompletar — usar comandos específicos para isso.

---

### item_close — Completar tarefa (simplificado)

```json
{
  "type": "item_close",
  "uuid": "<uuid>",
  "args": { "id": "6X7rfFVPjhvv84XG" }
}
```

Equivalente ao botão de completar no cliente: tarefas regulares vão para o arquivo, tarefas recorrentes avançam para a próxima ocorrência. **Preferir este ao `item_complete` para o caso de uso do projeto.**

---

### item_complete — Completar tarefa (completo)

```json
{
  "type": "item_complete",
  "uuid": "<uuid>",
  "args": {
    "id": "6X7rfFVPjhvv84XG",
    "date_completed": "2026-05-24T10:00:00.000000Z"
  }
}
```

| Argumento | Obrigatório | Descrição |
|-----------|-------------|-----------|
| `id` | **sim** | ID da tarefa |
| `date_completed` | não | RFC3339 em UTC. Padrão: timestamp atual do servidor |
| `from_undo` | não | Se `true`, não incrementa estatísticas de conclusão |

---

### item_delete — Deletar tarefa

```json
{
  "type": "item_delete",
  "uuid": "<uuid>",
  "args": { "id": "6X7rfFVPjhvv84XG" }
}
```

Deleta a tarefa e todas as subtarefas.

---

### item_uncomplete — Descompletar tarefa

```json
{
  "type": "item_uncomplete",
  "uuid": "<uuid>",
  "args": { "id": "6X7rfFVPjhvv84XG" }
}
```

Restaura uma tarefa completa. Ancestrais (itens e seções) também são restaurados. A tarefa aparece no final da lista do pai.

---

### Formato da resposta (escrita)

```json
{
  "sync_status": {
    "<uuid-ok>": "ok",
    "<uuid-erro>": {
      "error_tag": "INVALID_ARGUMENT_VALUE",
      "error_code": 20,
      "error": "Invalid argument value",
      "http_code": 400,
      "error_extra": {
        "argument": "file_url",
        "explanation": "file_url contains disallowed URL",
        "retry_after": 60
      }
    }
  },
  "temp_id_mapping": {
    "<temp_id>": "<id-real>"
  },
  "sync_token": "<novo-token>"
}
```

**Campos de erro (`error_extra`):**

| Campo | Descrição |
|-------|-----------|
| `argument` | Nome do argumento que causou o erro |
| `explanation` | Descrição detalhada |
| `retry_after` | Segundos para aguardar antes de retry (presente em rate limit e outros erros, não só 429) |
| `max_count` | Limite que foi excedido |
| `bad_item` | Informações sobre o item que causou o erro |

> ⚠️ `retry_after` pode aparecer dentro de `error_extra` (não só no header `Retry-After` ou campo top-level). O handler de rate limit deve verificar os três.

**Comportamento de falhas parciais:**
- Comandos executam **em ordem sequencial**
- Falha em um comando **não aborta** o batch — os demais continuam
- Cada `uuid` tem resultado independente em `sync_status`
- Verificar `sync_status` para cada UUID após o request é obrigatório

---

## Rate Limits

| Tipo | Limite |
|------|--------|
| Sync incremental (por usuário) | 1.000 requests / 15 minutos |
| Sync completo — `sync_token=*` (por usuário) | 100 requests / 15 minutos |
| Comandos por request | máx. **100** (conta como 1 request no rate limit) |
| Corpo do request (POST) | 1 MiB |
| Headers | 65 KiB |
| Timeout — requests padrão | 15 segundos |
| Timeout — uploads | 5 minutos |

**Resposta de rate limit:** HTTP `429 Too Many Requests` com `retry_after` em `error_extra` e header `Retry-After`.

---

## HTTP Status Codes

| Código | Descrição |
|--------|-----------|
| 200 | Sucesso |
| 400 | Request incorreto |
| 401 | Autenticação falhou ou ausente |
| 403 | Operação proibida |
| 404 | Recurso não encontrado |
| 429 | Rate limit excedido |
| 500 | Erro interno do servidor |
| 503 | Serviço temporariamente indisponível |
