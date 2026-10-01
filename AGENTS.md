# AGENTS.md — правила работы с репозиторием «Маяк» (Mayak)

> Инструкция для ИИ-агентов и разработчиков. Читай **до** любых изменений.
> Проект: **Маяк** (ex-«Пантеон» / ex-Pantheon) — open-source мультиагентная надстройка над [goose](https://github.com/block/goose).
> Основной язык документации и этого файла — русский, ключевые термины даны на английском.

---

## 1. Обзор проекта (Project overview)

Маяк — три слоя поверх sidecar `goose serve` (ACP / WebSocket):

| Слой | Что это | Тип изменений |
|---|---|---|
| **L0 — Личности** (personalities) | `agents/*.md` + `recipes/*.yaml` (oracle, librarian, metis, conductor) | **config-only**, без кода |
| **L1 — Плагин** (plugin) | `plugin/`: hooks (`SessionStart`, `PreToolUse`, `PostToolUse`, `SessionEnd`), **guard-rs** (read-only enforcement), MCP-инструменты (`pantheon_state.py`), bash-скрипты | код (Rust / bash / Python) |
| **L2 — UI** | `ui/mayak-ui` — активный клиент на **GPUIX** (React-слой) | код (TypeScript / TSX) |

Данные: `pantheon.db` (runs / artifacts / kv), `sessions.db` (goose-сессии), `pantheon.toml` (цепочки моделей), `config.yaml`.

➡️ Полная карта архитектуры: **[docs/architecture.md](docs/architecture.md)**.

---

## 2. Структура репо (Repository layout)

| Путь | Назначение | Статус |
|---|---|---|
| `ui/mayak-ui/` | Активный UI-клиент (GPUIX, Bun) | ✅ активный |
| `ui/pantheon-ui-tauri-legacy/` | Старый Tauri-клиент | ⚠️ **АРХИВ — не трогать** |
| `plugin/guard-rs/` | Rust-guard: read-only enforcement | ✅ активный |
| `plugin/hooks/`, `plugin/scripts/`, `plugin/mcp/` | Хуки, bash-скрипты, MCP-инструменты | ✅ активный |
| `agents/` | Личности (config-only markdown) | ✅ активный |
| `recipes/` | Рецепты-цепочки моделей (YAML) | ✅ активный |
| `sql/` | Схема и миграции (`schema.sql`, `migrations/`, `migrate.sh`) | ✅ активный |
| `docs/` | Архитектура, совместимость, аудит лицензий | ✅ активный |
| `packaging/`, `deploy.sh` | Упаковка и деплой | ✅ активный |

---

## 3. Конвенции кода (Code conventions)

| Правило | Детали |
|---|---|
| **Язык комментариев** | ТОЛЬКО **English** в коде (TS/Rust/bash/Python). Без исключений. |
| **Ошибки** | Только через `AppError` — `ui/mayak-ui/src/errors.ts`, коды `E.*` (например `E.CONFIG_NOT_FOUND`, `E.GOOSE_STARTUP`, `E.ACP_NO_SESSION`). Никаких «сырых» `throw new Error(...)`. |
| **Логи** | Только через `log` — `ui/mayak-ui/src/logger.ts`. Формат: `timestamp\|level\|module\|sid\|event\|detail`, напр. `2026-09-29T21:40:12.345Z \| ERROR \| acp.ts \| 20260929_3 \| session/load \| sessionId=undefined`. Ни одного `catch {}` без `log.error`. |
| **State machine** | Жизненный цикл сессии — явная state machine; новые переходы добавлять в неё, а не размазывать по обработчикам. |
| **Telemetry** | Применение изменений фиксировать: `recordUsage(...)`, `auditConfigChange(...)`. Не удалять вызовы. |

---

## 4. Точки входа (Entry points)

| Подсистема | Точка входа |
|---|---|
| mayak-ui bootstrap | `ui/mayak-ui/app.tsx` → `render(App)` |
| UI root / роутинг | `ui/mayak-ui/src/App.tsx` |
| ACP-клиент (WS → goose serve) | `ui/mayak-ui/src/acp.ts` |
| HTTP API-слой (Bun) | `ui/mayak-ui/src/api/*.ts` (`config.ts`, `db.ts`, `gooseServer.ts`, `catalog.ts`, `limits.ts`, …) |
| Guard | `plugin/guard-rs/` — сборка: `cargo build --release` |
| MCP-стор | `plugin/mcp/pantheon_state.py` |

---

## 5. Сборка и проверки (Build & checks)

Перед сдачей изменения — **все** проверки должны быть зелёные:

```bash
# 1) Типы mayak-ui — обязано быть 0 errors
cd ui/mayak-ui && bunx tsc --noEmit

# 2) Smoke-тесты — 19/19
cd ui/mayak-ui && bun scripts/smoke.ts

# 3) Rust-guard
cd plugin/guard-rs && cargo build --release
```

| Проверка | Критерий приёмки |
|---|---|
| `bunx tsc --noEmit` | **0 errors** |
| `bun scripts/smoke.ts` | **19/19** passed |
| `cargo build --release` | success |

---

## 6. Работа с конфигами (Config sync)

⚠️ **Критично:** смена модели **ОБЯЗАНА** синкаться одновременно в трёх местах:

1. `pantheon.toml` — цепочки моделей;
2. frontmatter в `agents/*.md`;
3. `recipes/*.yaml`.

Автосинк выполняется в `saveAgentChain` (`ui/mayak-ui/src/api/config.ts`) — используй его, **не правь файлы вразнос** (ручные точечные правки одного из трёх без остальных ломают согласованность).

---

## 7. Безопасность (Security)

- **guard-rs** — read-only enforcement: роли `oracle` / `librarian` / `metis` пишут **только** в `.pantheon/*.md`. Любая попытка записи в другие пути блокируется на `PreToolUse`.
- **Permission = DENY по умолчанию**: разрешено только явно перечисленное; новые возможности требуют явного allow-правила, а не «разрешить всё».
- Не ослаблять guard-правила и не добавлять обходы (`bypass`, широкие glob-паттерны) без обоснования в PR.

---

## 8. Лицензия (License)

Проект под **MIT** — см. [LICENSE](LICENSE).

- Выбор MIT обоснован аудитом: **[docs/licenses-audit.md](docs/licenses-audit.md)** — copyleft-зависимостей нет.
- Зависимости совместимы: GPUIX — **Apache-2.0**, goose sidecar — **Apache-2.0** (не влияет на лицензию Маяка), остальные — MIT / BSD-3-Clause / ISC.
- Новые зависимости: только пермиссивные (MIT / Apache-2.0 / BSD / ISC); copyleft (GPL/AGPL/SSPL) — запрещены. Обновлять `docs/licenses-audit.md` при добавлении.

---

## 9. Документация (Documentation)

- Минимум **RU + EN** для каждой заметной фичи (в README или `docs/`).
- `docs/` содержит (минимум):
  - `architecture.md` — архитектура и карта-граф;
  - `goose-152-compat.md` — совместимость с goose 1.52;
  - `licenses-audit.md` — аудит лицензий зависимостей.
- Ссылки на docs — относительные, чтобы работали на GitHub/GitLab.

---

## 10. Запреты (Hard rules / do-not)

| ❌ Нельзя | Почему |
|---|---|
| Трогать `ui/pantheon-ui-tauri-legacy/` | Архив, не собирается, мёртвый код |
| Удалять логгер (`src/logger.ts`) или telemetry-вызовы | Пункт приёма: по логу найти точку отказа любой транзакции |
| Новые фичи без `AppError` + логов | Теряется наблюдаемость (см. §3) |
| Править `pantheon.toml` / `agents/*.md` / `recipes/*.yaml` вразнос | Ломает sync моделей (см. §6) |
| Комментарии на не-английском в коде | Конвенция проекта (см. §3) |
| Ослаблять guard / permission-DENY | Нарушает модель безопасности (см. §7) |

---

## 11. Быстрый чек-лист (PR checklist)

- [ ] `bunx tsc --noEmit` → 0 errors
- [ ] `bun scripts/smoke.ts` → 19/19
- [ ] `cargo build --release` (если менялся `plugin/guard-rs`)
- [ ] Комментарии в коде — English
- [ ] Ошибки через `AppError` (`E.*`), логи через `log` (нет пустых `catch {}`)
- [ ] Синхронизация конфигов моделей (§6) не нарушена
- [ ] Документация RU+EN обновлена (при заметных изменениях)
- [ ] Зависимости — только пермиссивные лицензии
