# Маяк (ex-Пантеон)

**Маяк** — open-source мультиагентная надстройка над [goose](https://github.com/block/goose): **Оракул** (мышление), **Библиотекарь** (исследования), **Метис** (критика планов) и **Goose/кондуктор** (оркестратор+исполнитель) — с read-only guard-контуром, авто-эскалацией сложности, учётом расходов per-role и UI на GPUIX.

[License: MIT](LICENSE) · English: [docs/README.en.md](docs/README.en.md)

## Слои

| Слой | Что это | Статус | Где |
|---|---|---|---|
| **L0 — Личности** (config-only) | `oracle`, `librarian`, `metis`, `conductor` + рецепты-цепочки моделей | ✅ Phase 0 | `agents/` → `~/.agents/agents/`, `recipes/` → `~/.config/goose/recipes/` |
| **L1 — Плагин контроля** | hooks (PreToolUse guard, авто-эскалация, аудит), **guard-rs** (Rust), MCP-стор, `pantheon.db` | ✅ Phase 1 | `plugin/` → `~/.agents/plugins/pantheon/` |
| **L2 — UI mayak-ui** | чат (ACP), субагенты rail/stream, настройки, Панель Маяка (расходы/аудит), ctx-метр, лимиты | ✅ Phase 3–4 | `ui/mayak-ui/` — **активный стек (GPUIX)** |
| L2' — Tauri-клиент | старый клиент | 🗄 архив | `ui/pantheon-ui-tauri-legacy/` — не трогать |

## Документация

| Документ | RU | EN |
|---|---|---|
| Обзор, быстрый старт | [docs/README.md](docs/README.md) | [docs/README.en.md](docs/README.en.md) |
| Руководство пользователя (чат, субагенты, режимы, вложения, Панель, модели) | [docs/guide.ru.md](docs/guide.ru.md) | [docs/guide.en.md](docs/guide.en.md) |
| Архитектура (слои, потоки, state machine, guard, watchdog, логи) | [docs/architecture.ru.md](docs/architecture.ru.md) · [docs/architecture.md](docs/architecture.md) (карта-граф) | [docs/architecture.en.md](docs/architecture.en.md) |
| Для разработчиков (сборка, проверки, конвенции, config-sync) | [docs/development.ru.md](docs/development.ru.md) | [docs/development.en.md](docs/development.en.md) |
| Совместимость с goose 1.52 (аудит фич, P0–P3) | [docs/goose-152-compat.md](docs/goose-152-compat.md) | — |
| Аудит лицензий (111 JS + 32 Rust, copyleft нет) | [docs/licenses-audit.md](docs/licenses-audit.md) | — |
| Правила репо / PR-чек-лист | [AGENTS.md](AGENTS.md) | — |

## Модели (OpenCode Go, `~/.config/goose/pantheon.toml`)

| Роль | Primary | Fallbacks |
|---|---|---|
| Goose (кондуктор) | `opencode_go/mimo-v2.6-flash` | `deepseek-v4.1-flash` → `qwen3.8-flash` → `mimo-v2.6-flash` |
| Оракул | `opencode_go/mimo-v2.6-pro` | `glm-5.3-flash` → `minimax-m3` → `gpt-5.6-luna` |
| Метис | `opencode_go/mimo-v2.6-pro` | `glm-5.3-flash` → `minimax-m3` → `gpt-5.6-luna` |
| Библиотекарь | `opencode_go/mimo-v2.6-flash` | `glm-5.3-flash` → `qwen3.8-flash` |

⚠️ Смена модели синкается **автоматически** в три места (`pantheon.toml` + frontmatter `agents/*.md` + `recipes/*.yaml`) через `saveAgentChain` — не правьте вразнос.

## Установка и запуск

```bash
# L0 + L1: личности, плагин, БД, env
./deploy.sh                      # требует jq, sqlite3, python3

# L2: UI
cd ui/mayak-ui && bun install && bun app.tsx   # goose serve поднимается сам

# Проверки (все зелёные — пункт приёма)
cd ui/mayak-ui && bunx tsc --noEmit            # 0 errors
cd ui/mayak-ui && bun scripts/smoke.ts         # 19/19
cd plugin/guard-rs && cargo build --release    # success
# guard-политика: регресс 24/24 (docs/development.ru.md §4)
```

В `~/.config/goose/config.yaml`: `extensions.orchestrator.enabled: true`, расширение `pantheon-state` (stdio → `plugin/mcp/pantheon_state.py`).

## Безопасность (guard)

- **Оракул/Метис** пишут только `.pantheon/plans|analysis/*.md`; **Библиотекарь** — только `.pantheon/digests/*.md`; shell обеих — read-only whitelist (посегментная проверка пайпов/редиректов/backtick/`$()`/фона, git/sqlite3/python/sed).
- **goose/adhoc** — без ограничений; сбой guard'а → `on_failure: block` (fail-safe).
- Permission в UI — **DENY по умолчанию** (авто-allow только в режиме `auto`), режимы goose 1.52: `auto | approve | smart_approve | chat`.
- Регресс политики: **24/24** (`docs/development.ru.md` §4).

## Лицензия

**MIT** — см. [LICENSE](LICENSE). Выбор обоснован [docs/licenses-audit.md](docs/licenses-audit.md): copyleft-зависимостей нет; GPUIX и goose sidecar — Apache-2.0 (не влияет на лицензию Маяка), остальные — MIT/BSD-3-Clause/ISC. Новые зависимости — только пермиссивные.
