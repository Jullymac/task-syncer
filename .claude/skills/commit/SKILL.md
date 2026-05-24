---
name: commit
description: Use this skill whenever the user asks to commit changes — triggers include "commita", "faz commit", "commit das alterações", "comita isso", "commit", "commitar", or any equivalent in Portuguese or English. Runs lint (with auto-fix), composes a Conventional Commits message in English, and creates a single commit with all current changes (staged + unstaged).
---

# Skill de Commit

Aplique esta skill **somente quando o usuário pedir explicitamente para commitar**. Nunca commite de forma proativa.

## Scopes relevantes para este projeto

Use o scope mais específico que se aplica:

| Scope          | Quando usar                                    |
| -------------- | ---------------------------------------------- |
| `config`       | Variáveis de ambiente, configuração geral      |
| `db`           | Migrations, repositórios, client do PostgreSQL |
| `clickup`      | Serviço de chamadas à API do ClickUp           |
| `todoist`      | Serviço de chamadas à API do Todoist           |
| `sync`         | Lógica principal de sincronização              |
| `webhook`      | Handler e validação do webhook do ClickUp      |
| `jobs`         | Jobs de sync inicial, reconciliação ou retry   |
| `rate-limiter` | Gestão de rate limit e agendamento de retries  |
| `alerting`     | Criação de tasks de erro no Todoist            |
| `deploy`       | Configuração do Fly.io, Dockerfile, fly.toml   |
| `deps`         | Alterações em package.json / package-lock.json |

Omita o scope apenas se a mudança for verdadeiramente transversal a múltiplos módulos sem um denominador comum.

---

## Fluxo de execução

Execute os passos abaixo **em ordem**. Se qualquer passo falhar, pare e reporte — não pule etapas.

### 1. Inspecionar a árvore de trabalho

```bash
git status
git diff
git diff --staged
```

Leia os diffs reais. A mensagem de commit deve refletir o que mudou, não o que o usuário disse anteriormente na conversa.

### 2. Executar o linter com auto-fix

```bash
npm run lint:fix
```

Se o script não existir no `package.json`, pergunte ao usuário antes de continuar — não pule.

**Se o lint ainda falhar após o fix:** pare, mostre os erros restantes e pergunte ao usuário como proceder. Não commite código quebrado.

### 3. Re-stagear tudo

O lint pode ter modificado arquivos. Adicione toda a árvore de trabalho ao stage:

```bash
git add -A
```

### 4. Compor a mensagem de commit (Conventional Commits, em inglês)

Formato:

```
<type>(<scope>): <description>

[corpo opcional]

[rodapé opcional]
```

**Tipos** (use o mais específico que se aplica):

| Tipo       | Quando usar                                                      |
| ---------- | ---------------------------------------------------------------- |
| `feat`     | Nova funcionalidade visível ao usuário                           |
| `fix`      | Correção de bug                                                  |
| `refactor` | Mudança de código que não adiciona feature nem corrige bug       |
| `perf`     | Melhoria de performance                                          |
| `test`     | Adição ou atualização de testes apenas                           |
| `docs`     | Documentação apenas                                              |
| `style`    | Formatação, espaços, ponto-e-vírgula — sem mudança de lógica     |
| `build`    | Sistema de build, dependências, config do gerenciador de pacotes |
| `ci`       | Config de CI/CD (workflows, pipelines)                           |
| `chore`    | Manutenção que não se encaixa acima                              |
| `revert`   | Reversão de commit anterior                                      |

**Regras da descrição**:

- Modo imperativo: "add", "fix", "update" — não "added", "adds", "fixing".
- Primeira letra minúscula.
- Sem ponto final.
- Menos de 72 caracteres na linha de assunto.
- Seja específico: `feat(webhook): add ClickUp signature validation` — não `feat(webhook): webhook changes`.

**Corpo** (opcional): use quando o _o quê_ não é óbvio pelo assunto, ou para explicar o _por quê_. Quebre em ~72 caracteres. Separe do assunto com uma linha em branco.

**Breaking changes**: adicione `!` após type/scope (`feat(sync)!: ...`) E adicione um rodapé `BREAKING CHANGE:` explicando o impacto.

**Rodapés** (opcionais): `Refs: #123`, `Closes: #45`, `BREAKING CHANGE: ...`.

### 5. Agrupamento de commits

**Sempre crie um único commit** contendo todas as mudanças atuais (staged + unstaged após lint). Não divida em múltiplos commits a menos que o usuário peça explicitamente.

Se o diff genuinamente abrange preocupações não relacionadas, mencione isso no relatório após commitar — não divida unilateralmente.

### 6. Criar o commit

Use heredoc para preservar a formatação:

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <description>

<corpo opcional>

<rodapé opcional>
EOF
)"
```

**Não** adicione linhas de co-autoria Claude/AI, rodapés "Generated with" ou qualquer atribuição ao assistente.

### 7. Verificar

```bash
git status
git log -1 --stat
```

Confirme que o commit foi criado corretamente e a árvore de trabalho está limpa.

---

## Relatório final

Após o commit, reporte:

- Hash do commit (curto).
- Mensagem do commit (linha de assunto).
- Arquivos alterados (quantidade + lista se curta, caso contrário resumo).
- Quaisquer avisos de lint que não foram bloqueantes.
- Qualquer coisa que você notou mas não agiu (ex: "Notei mudanças não relacionadas em X — mantive neste commit conforme instruído; avise se quiser separar na próxima vez").

---

## Quando parar e perguntar

- Script `npm run lint:fix` ausente no `package.json`.
- Lint falha e não consegue corrigir automaticamente.
- Árvore de trabalho está limpa (nada para commitar).
- Diff está vazio após lint (tudo foi revertido).
- Um hook de pre-commit falha.
- Marcadores de conflito de merge detectados no diff.
- O diff contém o que parece ser secrets commitados (conteúdo de `.env`, API keys, tokens) — sinalize antes de commitar.

**Nunca bypass hooks** com `--no-verify` a menos que o usuário peça explicitamente.

---

## Exemplos para este projeto

```
feat(webhook): add ClickUp signature validation middleware
```

```
feat(jobs): implement initial sync job with pagination cursor
```

```
fix(rate-limiter): add 2-minute buffer to reset timestamp calculation
```

```
feat(sync): handle reassigned tasks by removing priority and due date
```

```
chore(db): add pending_events and job_state migrations
```

```
fix(todoist): preserve TaskSync label when updating task fields
```

```
build(deploy): add Fly.io configuration and Dockerfile
```
