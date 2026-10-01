# Разработка «Маяк» (RU)

> Инструкция для разработчиков: сборка, проверки, конвенции кода, config-sync, добавление личностей и моделей.
> Правила репо и PR-чек-лист: [../AGENTS.md](../AGENTS.md) · Архитектура: [architecture.ru.md](architecture.ru.md).

**English version:** [development.en.md](development.en.md)

---

## 1. Стек и структура репо

| Путь | Назначение | Статус |
|---|---|---|
| `ui/mayak-ui/` | Активный UI: GPUIX (`@gpuix/react` + `@gpuix/native` **0.10.0, пин только парой**), React 19, Bun, TypeScript 7 | ✅ |
| `ui/pantheon-ui-tauri-legacy/` | Старый Tauri-клиент | 🗄 **архив — не трогать** |
| `plugin/guard-rs/` | Rust-guard (`pantheon-guard`) | ✅ |
| `plugin/hooks/`, `plugin/scripts/`, `plugin/mcp/` | hooks.json, bash-скрипты, MCP `pantheon_state.py` | ✅ |
| `agents/`, `recipes/` | Личности и рецепты (config-only) | ✅ |
| `sql/` | `schema.sql`, `migrations/` (по `user_version`), `migrate.sh` | ✅ |
| `packaging/`, `deploy.sh` | Упаковка (legacy) и деплой L0+L1 | ✅ |

Точки входа:

| Подсистема | Точка входа |
|---|---|
| UI bootstrap | `ui/mayak-ui/app.tsx` → `render(App)` |
| Роутинг | `src/App.tsx` |
| ACP-клиент | `src/acp.ts` (`AcpSession`) |
| API-слой (Bun) | `src/api/*.ts` (`config`, `db`, `gooseServer`, `catalog`, `limits`, `clipboard`, `attachments`) |
| Guard | `plugin/guard-rs/` → бинарь `plugin/scripts/pantheon-guard` |
| MCP-стор | `plugin/mcp/pantheon_state.py` |

---

## 2. Сборка

```bash
# UI — зависимости (Bun)
cd ui/mayak-ui
bun install
# запуск dev
bun app.tsx

# Rust-guard
cd plugin/guard-rs
cargo build --release
# результат: target/release/pantheon-guard — guard-run.sh ищет его в candidate-путях
# (рядом со скриптом, target/release, ~/pantheon/plugin/guard-rs/target/release)

# Деплой L0+L1 (личности, плагин, схема БД)
cd ~/pantheon && ./deploy.sh

# Миграции БД
./sql/migrate.sh
```

Пин GPUIX — **только парой** `@gpuix/react@0.10.0` + `@gpuix/native@0.10.0` (нельзя поднимать по одному — притащит чужой native-бинарь). Pre-1.0: апгрейд только парой и осознанно.

Legacy-пакет (`packaging/build-pkg.sh`) — сборка Tauri-архива, для mayak-ui не используется.

---

## 3. Проверки (все должны быть зелёные)

```bash
# 1) Типы mayak-ui — 0 errors
cd ui/mayak-ui && bunx tsc --noEmit

# 2) Smoke-набор — 19/19
cd ui/mayak-ui && bun scripts/smoke.ts

# 3) Guard-политика — регресс 24/24 (см. §4)
# 4) Rust-guard собирается
cd plugin/guard-rs && cargo build --release
```

| Проверка | Критерий приёмки |
|---|---|
| `bunx tsc --noEmit` | **0 errors** |
| `bun scripts/smoke.ts` | **19/19 passed** (exit 0) |
| guard-прогон | **24/24** (нет строк `✗`) |
| `cargo build --release` | success |

Что покрывает smoke (`scripts/smoke.ts`, headless):
1. логгер (`setLogSession`, `logged`-fallback);
2. structured errors (`AppError`, `toAppError`, `tryOrAppErrorSync`);
3. API db (`openPantheon`, `listSessions`, `getPantheonOverview`, `listSubagentChildren`, `kvSet`);
4. API config (`getAgentChains`, `getConfigSummary`, `getConfigLimits`, `listPromptFiles`, автосинк `saveAgentChain` → frontmatter);
5. каталог (`getProviderCatalog`);
6. state machine (контракт 6 состояний);
7. guard-rs (бинарь существует).

Дополнительные тесты (по мере необходимости): `scripts/api-test.ts` (форматы API на временных копиях конфигов), `scripts/acp-contract-test.mjs` (контракт ACP против live `goose serve`), `scripts/acp-smoke.ts`.

PR-чек-лист — в [../AGENTS.md](../AGENTS.md) §11.

---

## 4. Guard: регресс 24/24

Политика проверяется живым бинарём: питается JSON-пейлоад PreToolUse, роль прописывается в тестовую `runs`. Эталонный прогон (bash-обёртка `t()`):

```bash
GUARD=~/pantheon/plugin/guard-rs/target/release/pantheon-guard
export PANTHEON_DB=/tmp/test-guard.db
# создать БД: sqlite3 $PANTHEON_DB < ~/pantheon/sql/schema.sql
t() { # t <name> <role> <tool> <extra-json> <allow|block>
  local sid="tf$RANDOM"
  sqlite3 "$PANTHEON_DB" "INSERT OR REPLACE INTO runs(session_id, role) VALUES('$sid', '$2');"
  local out; out=$(printf '%s' "{\"session_id\":\"$sid\",\"tool_name\":\"$3\"$4}" | $GUARD 2>/dev/null)
  local got=allow; echo "$out" | grep -q '"decision":"block"' && got=block
  [ "$got" != "$5" ] && echo "✗ $1 → $got (expect $5)"
}
```

Набор 24 кейсов (нет строк `✗` → 24/24):

| # | Кейс | Роль/инструмент | Ожидание |
|---|---|---|---|
| 1 | oracle-plans | oracle, write `.pantheon/plans/p.md` | allow |
| 2 | oracle-analysis | oracle, write `.pantheon/analysis/a.md` | allow |
| 3 | oracle-evil | oracle, write `/tmp/evil.sh` | **block** |
| 4 | oracle-digests | oracle, write `.pantheon/digests/x.md` | **block** (не его путь) |
| 5 | oracle-traversal | oracle, write `.pantheon/plans/../e.md` | **block** (traversal) |
| 6 | lib-digests | librarian, write `.pantheon/digests/d.md` | allow |
| 7 | lib-plans | librarian, write `.pantheon/plans/p.md` | **block** |
| 8 | goose-evil | goose, write `/tmp/evil.sh` | allow (unrestricted) |
| 9 | cat | oracle, `cat foo` | allow |
| 10 | pipe | oracle, `ls \| grep x` | allow |
| 11 | rm | oracle, `rm -rf /` | **block** |
| 12 | backtick | oracle, ``echo `id` `` | **block** |
| 13 | dollar | oracle, `echo $(id)` | **block** |
| 14 | bg | oracle, `sleep 5 &` | **block** |
| 15 | redirect | oracle, `echo x > /tmp/f` | **block** |
| 16 | devnull-sp | oracle, `ls > /dev/null` | allow |
| 17 | devnull-nosp | oracle, `ls >/dev/null` | allow |
| 18 | git-log | oracle, `git log` | allow |
| 19 | git-push | oracle, `git push` | **block** |
| 20 | sql-select | oracle, `sqlite3 db "SELECT 1"` | allow |
| 21 | sql-insert | oracle, `sqlite3 db "INSERT …"` | **block** |
| 22 | sed-i | oracle, `sed -i s/a/b/ f` | **block** |
| 23 | sed-ok | oracle, `sed s/a/b/ f` | allow |
| 24 | goose-rm | goose, `rm /tmp/x` | allow |

После правок guard'а прогон **обязателен**; политику и whitelist ослаблять нельзя без обоснования в PR (AGENTS.md §7/§10).

---

## 5. Конвенции кода

| Правило | Детали |
|---|---|
| **Язык комментариев** | ТОЛЬКО **English** в коде (TS/Rust/bash/Python). Без исключений |
| **Ошибки** | Только `AppError` — `src/errors.ts`, коды `E.*` (`E.CONFIG_NOT_FOUND`, `E.GOOSE_STARTUP`, `E.ACP_NO_SESSION`, …). Никаких сырых `throw new Error(...)` |
| **Логи** | Только `log` — `src/logger.ts`. Формат: `timestamp \| level \| module \| sid \| event \| detail`. Ни одного `catch {}` без `log.error`/`log.fail` |
| **State machine** | Жизненный цикл сессии — явная машина состояний (`VALID_TRANSITIONS`); новые переходы добавлять **только** в неё |
| **Telemetry** | Применение изменений фиксировать: `recordUsage(...)`, `auditConfigChange(...)`. Не удалять вызовы |
| **Заглушки** | Пустые catch, мёртвый код, «TODO без дела» — не оставлять; фичи без AppError+логов не добавлять |
| **GPUIX-ловушки** | `display:"flex"` обязателен для flex-свойств; `display:none` игнорируется (использовать условный JSX); `<text>` — один строковый ребёнок; nested scroll запрещён (expandable, не inner overflow); `estimatedItemHeight` обязателен; пин парой 0.10.0 |

Пример лога:

```ts
log.error("session/load", `sessionId=${id} fallback=loadId`);
// 2026-09-29T21:40:12.345Z | ERROR | acp.ts | 20260929_3 | session/load | sessionId=undefined fallback=loadId
```

Пример ошибки:

```ts
throw new AppError(E.CONFIG_BAD_MODE, `unknown mode: ${mode}`, { context: { mode } });
// UI показывает userMessage; detail+code — в лог
```

---

## 6. Config-sync (критично)

Смена модели **обязана** синкаться одновременно в трёх местах:

1. `~/.config/goose/pantheon.toml` — цепочки (источник UI);
2. frontmatter `agents/<role>.md` → `model:`;
3. `recipes/<role>-*.yaml` → `settings.goose_model`.

Автосинк — `saveAgentChain` (`ui/mayak-ui/src/api/config.ts`, внутренний `syncModelToRuntime`). **Всегда** использовать его; точечные ручные правки одного из трёх без остальных ломают delegate (recipe/frontmatter побеждают override в delegate — старая модель продолжит работать).

Приоритет модели в goose (`resolve_model_config`):
`recipe.settings.goose_model` → env `GOOSE_SUBAGENT_MODEL` → delegate `params.model` → configured → provider default.

`pantheon.toml` **не** читается delegate'ом — это слой UI/документации; одна его правка ничего не меняет.

---

## 7. Добавление личности (новая роль)

1. **`agents/<role>.md`** — frontmatter `name`, `description` (useWhen/avoidWhen-триггеры), `model:`; тело — системный промпт. Для read-only-роли прописать политику путей явно.
2. **`recipes/<role>-*.yaml`** — `settings.goose_provider`, `goose_model` (= frontmatter), `temperature`, `max_turns: 1000`, `extensions` (summon/developer/…).
3. **Guard-политика** (`plugin/guard-rs/src/main.rs` + fallback `plugin/scripts/guard.sh`) — добавить роль в write-политику (как `oracle`/`metis` или `librarian`); роли нет в runs → treat как `adhoc`/`goose` — не забыть регистрировать роль в SessionStart.
4. **Цепочки** — добавить секцию `[agents.<role>]` в `pantheon.toml` и строку в `saveAgentChain`/`getAgentChains` (чтобы роль появилась в ChainEditor), если роль поддерживает fallback-цепочку.
5. **Кондуктор** — описать триггеры вызова в `agents/pantheon-conductor.md` (delegate source, уровень эскалации, cost-awareness).
6. **Расходы** — роль автоматически попадёт в `usage_ledger`/Панель через `runs.role`; эмодзи/цвет — `PantheonPanel.tsx` (`ROLE_EMOJI`, `roleColor`).
7. **Задеплоить**: `./deploy.sh`; проверки: `bunx tsc --noEmit`, `bun scripts/smoke.ts`, guard-прогон.
8. **Документация RU+EN** — обновить README/guide (конвенция: каждая заметная фича ≥ в двух редакциях).

Чек-лист отката: схема БД не менялась (роль — текст), миграции не нужны.

---

## 8. Добавление / смена модели

1. Убедиться, что модель есть в каноне/каталоге: `api/catalog.ts` (MERGE API `/v1/models` + file-is-truth `~/.config/goose/opencode-go-models.json` — там context_limit/modalities/цены).
2. Добавить/поправить шаг цепочки через **ChainEditor** («Проверить» → `validateChainStep`, маппинг 403/400) — так автосинк отработает сам.
3. Ручной путь (без UI): править **все три** места (§6) либо один `saveAgentChain`.
4. Vision/текст: проверить `modalities_in` (image) — иначе субагенты получат «image was omitted»; таблица vision-моделей — в промпте `subagent_system.md`.
5. Цены для расходов: прайс-файл (`modelPrices()` в `api/db.ts`); без цены `cost` будет NULL → «—» в Панели.
6. Smoke: `bun scripts/smoke.ts` (кейс автосинка проверяет frontmatter).

---

## 9. Схема данных и миграции

- Схема: `sql/schema.sql` (`runs`, `artifacts`, `projects`, `kv`, `handoffs`, `events`).
- UI-слои в `src/api/db.ts` создают `usage_ledger` и `events` идемпотентно (`CREATE TABLE IF NOT EXISTS`).
- Миграции: `sql/migrations/pantheon/`, `sql/migrations/sessions/` — файлы `NNN_*.sql` с `PRAGMA user_version = N`; раннер `sql/migrate.sh` (применяет по порядку, лог в `guard.log`).
- `sessions.db` читается напрямую; пишет его только goose.

---

## 10. Наблюдаемость при разработке

- Где логи: `~/.local/state/mayak-ui/mayak.log` (UI), `goose-serve.log` (sidecar), `~/.local/state/pantheon/guard.log` (плагин), `~/.local/state/goose/logs/llm_request.*.jsonl` (payload LLM).
- Уровень UI-логов: `MAYAK_LOG=debug`.
- Каждая новая фича: AppError (или graceful false) + лог входа/выхода/ошибки; «по логу найти точку отказа любой транзакции» — пункт приёма.
- Audit/usage-вызовы (`auditConfigChange`, `recordUsage`) — обязательны в путях изменения конфигов и потребления токенов.

---

*Актуально на 2026-10-01 · Проверки: tsc 0 · smoke 19/19 · guard 24/24*
