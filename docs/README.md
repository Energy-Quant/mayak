# Документация «Маяк» (RU)

> **Маяк** (ex-«Пантеон» / ex-Pantheon) — open-source мультиагентная надстройка над [goose](https://github.com/block/goose): личности с разными моделями, read-only guard-контур, авто-эскалация сложности, учёт расходов и split-view UI.
> Лицензия: **MIT** · Сторонние зависимости: пермиссивные (GPUIX и goose — Apache-2.0, copyleft нет) → см. [licenses-audit.md](licenses-audit.md).

**English version:** [README.en.md](README.en.md)

---

## Что такое Маяк

Маяк — это три слоя поверх sidecar `goose serve` (ACP / WebSocket):

| Слой | Что это | Где в репо | Статус |
|---|---|---|---|
| **L0 — Личности** (personalities) | Конфиги без кода: `oracle.md`, `librarian.md`, `pantheon-metis.md`, `pantheon-conductor.md` + рецепты-цепочки моделей | `agents/`, `recipes/` | ✅ config-only |
| **L1 — Плагин контроля** (plugin) | Hooks (SessionStart/PreToolUse/UserPromptSubmit/PostToolUse/SessionEnd), **guard-rs** (Rust read-only enforcement), авто-эскалация, MCP-инструменты состояния | `plugin/` | ✅ |
| **L2 — UI-клиент** | **mayak-ui** на GPUIX (React-слой, без webview): чат, субагенты, настройки, Панель Маяка | `ui/mayak-ui/` | ✅ активный стек |
| L2' — Tauri-клиент | Старый Tauri-клиент | `ui/pantheon-ui-tauri-legacy/` | 🗄 архив, не собирается |

Данные: `pantheon.db` (runs / artifacts / kv / events / usage_ledger), `sessions.db` (goose-сессии), `pantheon.toml` (цепочки моделей), `~/.config/goose/config.yaml`.

### Личности

| Роль | Что делает | Пишет куда | Модель (primary, rev) |
|---|---|---|---|
| **Оракул** (oracle) | Стратегическое мышление, планы, архитектура | только `.pantheon/{plans,analysis}/*.md` | `opencode_go/mimo-v2.6-pro` |
| **Библиотекарь** (librarian) | Исследования доков/исходников, дайджесты с permalink | только `.pantheon/digests/*.md` | `opencode_go/mimo-v2.6-flash` |
| **Метис** (metis) | Критик планов: атакует план, ищет слабости/риски/дыры | только `.pantheon/{plans,analysis}/*.md` | `opencode_go/mimo-v2.6-pro` |
| **Goose/кондуктор** | Оркестратор + исполнитель (основной чат) | без ограничений | `opencode_go/mimo-v2.6-flash` |

Все три личности — **read-only**: любая попытка записи вне своих путей блокируется guard'ом на `PreToolUse` (`on_failure: block`).

---

## Быстрый старт

```bash
# 1) Требования: goose 1.52, bun, cargo, jq, sqlite3, python3
goose --version          # 1.52.0+

# 2) Установка слоёв L0 + L1 (личности, плагин, БД, env)
cd ~/pantheon
./deploy.sh

# 3) Проверить ~/.config/goose/config.yaml:
#    extensions.orchestrator.enabled: true
#    extensions.pantheon-state (stdio → python3 ~/.agents/plugins/pantheon/mcp/pantheon_state.py)

# 4) Запуск UI (L2)
cd ui/mayak-ui && bun install && bun app.tsx
# UI сам поднимает sidecar `goose serve` (allowed-origin + секрет) — вручную его запускать не нужно
```

Подробности (чат, субагенты, режимы, вложения, Панель): **[guide.ru.md](guide.ru.md)**.

---

## Индекс документации

| Документ | RU | EN | О чём |
|---|---|---|---|
| Главная | **вы здесь** | [README.en.md](README.en.md) | Обзор, слои, быстрый старт |
| Пользовательское руководство | [guide.ru.md](guide.ru.md) | [guide.en.md](guide.en.md) | Установка, чат, субагенты, режимы, вложения, Панель, настройки моделей |
| Архитектура | [architecture.ru.md](architecture.ru.md) · [architecture.md](architecture.md) | [architecture.en.md](architecture.en.md) | 3 слоя, потоки данных, state machine, guard, watchdog, логирование |
| Для разработчиков | [development.ru.md](development.ru.md) | [development.en.md](development.en.md) | Сборка, проверки (tsc/smoke/guard), конвенции, config-sync, добавление личностей |
| Совместимость с goose 1.52 | [goose-152-compat.md](goose-152-compat.md) | — | Полный аудит фич (10 категорий, приоритеты P0–P3) |
| Аудит лицензий | [licenses-audit.md](licenses-audit.md) | — | 111 JS + 32 Rust зависимостей, рекомендация MIT |
| Правила репо | [../AGENTS.md](../AGENTS.md) | — | Конвенции кода, запреты, PR-чек-лист |

---

## Ключевые фичи (кратко)

- **Три слоя + кондуктор** — распределение задач по уровням сложности; delegate субагентов идёт через goose orchestrator.
- **Auto-escalation** — хук `UserPromptSubmit` (`escalate.sh`) классифицирует каждый промпт в `LOW/MED/HIGH/CRIT` и вешает тег `[ESCALATION:LEVEL]`; кондуктор реагирует: LOW → сам, HIGH → Оракул, CRIT → полная цепочка (Библиотекарь → Оракул → Метис).
- **Metis** — личность-критик планов (adversarial review): атакует план до реализации, выдаёт список уязвимостей с severity; никогда не переписывает план.
- **guard-rs** — Rust-guard на `PreToolUse`: политика write-targeting по ролям + read-only whitelist shell (посегментно: пайпы, редиректы, backtick/`$()`, фон, git/sqlite3/python/sed). Fail-safe: любой сбой guard'а = block. Регресс **24/24**.
- **Режимы goose 1.52** — `auto | approve | smart_approve | chat` в Settings; живая сессия получает режим через ACP `session/set_mode`, новые — через `GOOSE_MODE` в `config.yaml`.
- **Permission DENY по умолчанию** — `session/request_permission` никогда не авто-разрешается: авто-allow только в явном режиме `auto`, иначе deny с логом (`acp.permission.*`).
- **Watchdog** — health-check `goose serve` (`/status`) каждые 10 с, reconnect с backoff до 8 с, resurrect сессии; generation-guards и очередь `start/load` исключают гонки.
- **State machine сессии** — `idle → connecting → ready → streaming → closed` (+ `error`); недопустимые переходы игнорируются с записью в лог.
- **Сквозное логирование** — единый формат `timestamp | level | module | sid | event | detail` для TS/Rust/Python/bash; без `catch {}` без лога.
- **Расходы per-role** — `usage_update` → `usage_ledger` → Панель: «РАСХОДЫ · 7 ДНЕЙ» (in/out токены, USD по прайс-листу моделей).
- **Аудит правок** — `auditConfigChange` пишет в `pantheon.db events` (hash + превью старого/нового значения); Панель → «ИСТОРИЯ ПРАВОК».
- **Scroll-кнопка ↓** — плавающая кнопка «к последнему сообщению» в ленте чата (overlay, без nested scroll — правило GPUIX).
- **Субагенты** — event-driven rail (tool_call с `_meta.subagent_session_id` + reconcilation), live-стрим SubagentStream, передача изображений через `[imgs]`-реестр и автоконтекст.
- **Лимиты OpenCode Go** — UsageBar: окна 5ч/нед/мес (опрос `/v1/usage` каждые 30 с).

---

## Лицензия

Проект под **MIT** — см. [../LICENSE](../LICENSE).

- Выбор MIT обоснован аудитом: [licenses-audit.md](licenses-audit.md) — **copyleft-зависимостей нет**.
- Совместимость: GPUIX (`@gpuix/*`) — Apache-2.0, goose sidecar — Apache-2.0 (не влияет на лицензию Маяка), остальные — MIT / BSD-3-Clause / ISC.
- Новые зависимости — только пермиссивные; GPL/AGPL/SSPL запрещены (см. [../AGENTS.md](../AGENTS.md) §8).
