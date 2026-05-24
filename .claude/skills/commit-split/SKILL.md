---
name: commit-split
description: Use this skill whenever the user asks to commit changes in parts/multiple commits — triggers include "commita em partes", "comita em partes", "split em vários commits", "quebra em commits", "vários commits", "commit em partes", "commit em pedaços", or any equivalent phrasing in Portuguese or English asking to split current changes into multiple logical commits. Stashes everything as backup, plans a sequence of small functional commits, asks for approval, then executes commit-by-commit with lint verification between each. Aborts and restores the stash on any failure.
---

# Skill de Commit Split

Aplique esta skill **somente quando o usuário pedir explicitamente para dividir as mudanças em múltiplos commits**. Para um único commit cobrindo tudo, use a skill `commit`.

Esta skill complementa a skill `commit` — cada commit produzido aqui deve seguir as **mesmas regras de Conventional Commits** definidas lá (tipos, scopes, modo imperativo, inglês, sem atribuição de IA, formato heredoc, etc.). Releia `commit.md` se necessário.

## Scopes relevantes para este projeto

Mesmos scopes definidos em `commit.md`:
`config`, `db`, `clickup`, `todoist`, `sync`, `webhook`, `jobs`, `rate-limiter`, `alerting`, `deploy`, `deps`

---

## Visão geral

Fases:

1. **Inspecionar** — ler os diffs atuais (staged + unstaged).
2. **Backup** — destagear tudo, criar stash com label conhecido.
3. **Planejar** — propor uma sequência de commits pequenos e funcionais com justificativa.
4. **Aprovar** — aguardar aprovação do usuário; nunca executar o plano unilateralmente.
5. **Executar** — para cada commit: restaurar só aquela parte, lint, commit, verificar.
6. **Limpeza** — descartar o stash de backup ao final com sucesso.
7. **Abortar** — em qualquer falha: reverter commits feitos, restaurar o stash de backup, reportar.

---

## Fase 1 — Inspecionar

```bash
git status
git diff
git diff --staged
git log -1 --oneline
```

Leia todos os diffs por completo. O plano deve ser baseado nas mudanças reais, não em suposições.

Se a árvore de trabalho estiver limpa → pare e informe ao usuário que não há nada para commitar.

Se o diff contiver marcadores de conflito, secrets (conteúdo de `.env`, API keys, tokens) ou qualquer coisa suspeita → pare e sinalize antes de tocar em qualquer coisa.

---

## Fase 2 — Backup

Destagear tudo (sem perder as mudanças):

```bash
git reset
```

Capturar **todas** as mudanças em um stash, incluindo arquivos não rastreados:

```bash
git stash push --include-untracked --message "commit-split-backup-$(date +%s)"
```

Salve a referência do stash para uso posterior (`git stash list` mostrará `stash@{0}` como o recém-criado — confirme batendo com a mensagem).

Após este passo, a árvore de trabalho está limpa. Todo o trabalho está seguro no stash.

---

## Fase 3 — Planejar

Restaure as mudanças para a árvore de trabalho sem descartar o stash:

```bash
git stash apply stash@{0}
```

Agora analise o diff e desenhe a sequência de commits.

### Princípios de divisão

Cada commit deve ser:

- **Uma preocupação lógica** — uma feature, um fix, um refactor, um chore. Nunca misture.
- **Pequeno o suficiente para revisar rapidamente** — se um commit muda mais de 10 arquivos ou 300 linhas de mudanças substantivas e eles não estão fortemente acoplados, considere dividir mais.

  **O que conta para o limite de tamanho:**
  - Arquivos com mudanças reais de lógica (código novo, código modificado, código deletado).

  **O que NÃO conta:**
  - Arquivos de teste (`*.spec.ts`, `*.test.ts`) — vivem junto com o código que cobrem.
  - Arquivos onde apenas imports mudaram (atualizações de caminho após mover/renomear).

- **Grande o suficiente para passar no lint** — nunca deixe o código quebrado entre commits.
- **Ordenado por dependência** — se o commit B referencia símbolos do commit A, A vem primeiro.

### Padrões comuns para este projeto

| Padrão                                      | Exemplo                                                      |
| ------------------------------------------- | ------------------------------------------------------------ |
| DB antes de serviços                        | Migration de `task_mapping` antes do `sync.ts` que a usa     |
| Serviços antes de jobs                      | `clickup.ts` e `todoist.ts` antes dos jobs que os chamam     |
| Rate limiter antes de qualquer chamada HTTP | `rate-limiter.ts` antes de `clickup.ts` e `todoist.ts`       |
| Webhook handler após serviços               | `webhook/clickup.ts` após `sync.ts` estar pronto             |
| Testes junto com o código                   | Testes ficam no mesmo commit que o código que cobrem         |
| Deploy separado                             | `build(deploy)` sempre no último commit                      |
| Deps separado de código                     | Alterações em `package.json` no próprio commit `build(deps)` |

### Anti-padrões a evitar

- Um commit `chore: misc changes` coletando sobras — sempre encontre uma preocupação real.
- Dividir as mudanças de uma única função entre commits.
- Um commit de "fixup" corrigindo o commit anterior (significa que a divisão estava errada; refaça o plano).
- Commitar estados intermediários que não passam no lint.

### Construir um plano

Para cada commit proposto, liste:

- **Índice** (1, 2, 3…) — ordem de execução.
- **Mensagem de Conventional Commits** (linha de assunto, mais corpo se necessário).
- **Arquivos** — lista completa de arquivos (e para commits de arquivo parcial, quais hunks).
- **Justificativa** — 1–2 frases explicando _por que_ isso é um commit coeso e _por que_ deve estar nessa posição.

Depois **limpe a árvore de trabalho antes de mostrar o plano**:

```bash
git reset --hard HEAD
git clean -fd
```

O stash ainda mantém tudo em segurança.

---

## Fase 4 — Aprovar

Apresente o plano ao usuário com esta estrutura:

```markdown
## Plano de commits (N commits)

Backup stash: `stash@{0}` — message `commit-split-backup-<timestamp>`

### Commit 1/N

**Mensagem:** `<type>(<scope>): <description>`

<corpo opcional>

**Arquivos:**

- `path/to/file1.ts` (completo)
- `path/to/file2.ts` (hunks: linhas 10-25, 80-95)

**Justificativa:** <por que esses arquivos pertencem juntos e por que nessa ordem>

---

### Commit 2/N

...
```

Então **pare e aguarde** aprovação explícita. Aprovações aceitáveis: "ok", "aprovado", "pode executar", "go", "yes", ou uma solicitação de mudanças.

**Não prossiga sem aprovação explícita.** Silêncio ≠ aprovação.

Se o usuário solicitar mudanças, revise o plano e reapresente por completo.

---

## Fase 5 — Executar

Para cada commit `i` do plano aprovado, em ordem:

### 5.1 Restaurar o stash para a árvore de trabalho

Se for o primeiro commit:

```bash
git stash apply stash@{0}
```

Se for um commit subsequente, a iteração anterior já deixou as mudanças restantes na árvore de trabalho — pule este passo.

### 5.2 Stagear exatamente os arquivos/hunks do commit `i`

Para arquivos completos:

```bash
git add path/to/file1.ts path/to/file2.ts
```

Para arquivos parciais (hunks específicos):

```bash
git add -p path/to/file.ts
```

Se os hunks não se aplicarem limpos → **aborte a skill**.

### 5.3 Lint com auto-fix no escopo do commit

```bash
npm run lint:fix
```

Re-stagear apenas os arquivos do commit atual se o lint os modificar:

```bash
git add -A -- <arquivos deste commit>
```

**Não** stagear arquivos fora do escopo do commit atual, mesmo que o lint os tenha tocado. Eles pertencem a um commit posterior.

Se o lint ainda falhar após `--fix` → **aborte** (veja Fase 7).

### 5.4 Verificar se o commit será funcional

Verificar lint final na árvore staged. Fazer stash temporário das mudanças não staged:

```bash
git stash push --keep-index --include-untracked --message "commit-split-temp-$i"
npm run lint
git stash pop
```

Se o lint falhar → **aborte** (veja Fase 7).

> Nota: não executamos `npm run build` entre cada commit para não bloquear o fluxo — o TypeScript pode ter dependências cruzadas entre arquivos que só estarão completas no commit final. O lint é suficiente como verificação intermediária. Executar `npm run build` ao final de todos os commits.

### 5.5 Criar o commit

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <description>

<corpo opcional>

<rodapé opcional>
EOF
)"
```

### 5.6 Confirmar

```bash
git log -1 --stat
```

Reporte brevemente: commit `i/N` feito, hash, arquivos. Avance para o commit `i+1`.

---

## Fase 6 — Limpeza

Após o **último** commit, verificar build completo:

```bash
npm run build
```

Se falhar → **aborte** (Fase 7).

Se passar:

```bash
git status
git log --oneline -<N>
```

Confirme:

- Árvore de trabalho está limpa.
- N commits foram criados na ordem esperada.

Se qualquer coisa do diff original estiver faltando nos commits → **aborte**.

Se estiver tudo correto, descarte o stash de backup:

```bash
git stash drop stash@{0}
```

Verifique se a mensagem do stash bate com `commit-split-backup-*` antes de descartar — nunca descarte um stash arbitrário.

Reporte o resumo final:

- Número de commits feitos.
- Lista de `<hash> <assunto>` para cada um.
- Confirmação de que o build passou e o stash de backup foi descartado.

---

## Fase 7 — Abortar

Acionado por qualquer um dos seguintes:

- Lint ainda falha após `--fix`.
- Build falha na Fase 6.
- Hunks do plano não se aplicam mais limpos.
- Hook de pre-commit falha.
- Um commit falha inesperadamente.
- Estado da árvore de trabalho diverge do que o plano espera.
- Usuário pede para abortar no meio da execução.

### Procedimento de abort

1. Identificar quantos commits do plano foram feitos.
2. Resetar HEAD para antes do início da skill:
   ```bash
   git reset --hard <HEAD-pré-skill>
   ```
   Use o hash capturado na Fase 1. Se não tiver capturado, use `git reflog` para encontrá-lo.
3. Restaurar o stash de backup:
   ```bash
   git stash pop stash@{<índice do stash commit-split-backup-*>}
   ```
   Encontre o índice certo com `git stash list` — bata com a mensagem.
4. Verificar que a árvore de trabalho corresponde ao estado original.
5. Reportar:
   - O que falhou e em qual passo/commit do plano.
   - Que os commits foram revertidos.
   - Que o stash de backup foi restaurado.
   - Próxima ação sugerida.

**Nunca descarte o stash de backup em abort.**

---

## Quando parar e perguntar (sem abortar)

- Árvore de trabalho está limpa antes de começar → avise o usuário.
- O diff naturalmente cabe em um único commit → sugira usar a skill `commit`.
- A mensagem de aprovação do usuário é ambígua → confirme explicitamente antes de executar.
- O plano precisa de mais de 8 commits → sinalize e pergunte se o usuário quer prosseguir ou dividir em múltiplas sessões.

---

## Exemplo de fluxo para este projeto

Usuário: _"commita em partes"_

Claude:

1. Executa `git status` / `git diff` — encontra migrations, serviços de API, lógica de sync e handler de webhook.
2. Faz stash de tudo como `commit-split-backup-1715300000`.
3. Planeja commits na ordem:
   - `build(deps): add project dependencies`
   - `chore(config): add env validation and config module`
   - `chore(db): add database client and migrations`
   - `feat(clickup): add ClickUp API service`
   - `feat(todoist): add Todoist API service`
   - `feat(rate-limiter): add rate limit handling with retry scheduling`
   - `feat(sync): add core sync logic and task mapping`
   - `feat(webhook): add ClickUp webhook handler and signature validation`
   - `feat(jobs): add initial, reconciliation and retry jobs`
   - `build(deploy): add Fly.io configuration and Dockerfile`
4. Apresenta o plano com arquivos + justificativa.
5. Aguarda aprovação.
