# Пантеон

Мультиагентная надстройка над goose: **Оракул** (мышление, read-only), **Библиотекарь** (исследования, read-only), **Goose** (оркестратор+исполнитель). Полный план: `~/Documents/Obsidian Vault/02 Проекты/Pantheon/План и архитектура — Пантеон.md` (ревизия 2).

## Слои
| Слой | Статус | Где |
|---|---|---|
| 1. Личности (config-only) | ✅ Phase 0 | `agents/` → `~/.agents/agents/`, `recipes/` → `~/.config/goose/recipes/` |
| 2. Контроль (hooks+DB+MCP) | ✅ Phase 1 | `plugin/` → `~/.agents/plugins/pantheon/` |
| 3. Tauri-клиент pantheon-ui | 🚧 Phase 2 | `ui/pantheon-ui/` (скелет) |

## Модели (подписка OpenCode Go, rev 2)
| Роль | Primary | Fallbacks |
|---|---|---|
| Goose | `opencode_go/glm-5.3-flash` | `opencode_go/glm-5.3` |
| Оракул | `opencode_go/glm-5.3` | `opencode_go/kimi-k3` → `opencode_go/gpt-5.6-luna` |
| Библиотекарь | `opencode_go/deepseek-v4.1-flash` ⚠️ Privacy=Global | `opencode_go/glm-5.3-flash` → `ollama_cloud/deepseek-v4-flash:0731` |

Цепочки: `~/.config/goose/pantheon.toml` (редактируются нативно из pantheon-ui, Phase 2).

## Установка
```bash
./deploy.sh
```
Требует: jq, sqlite3, python3. Проверить в `~/.config/goose/config.yaml`: `extensions.orchestrator.enabled: true`, `extensions.pantheon-state` (stdio → `plugin/mcp/pantheon_state.py`).

## Контроль прав (guard)
- Оракул пишет только `.pantheon/plans/*.md` и `.pantheon/analysis/*.md`
- Библиотекарь — только `.pantheon/digests/*.md`
- shell обоих — read-only whitelist (посегментная проверка пайпов/редиректов)
- Goose/adhoc — без ограничений; on_failure: block (fail-safe)

## Тесты (2026-09-18, все зелёные)
- Guard: 26 кейсов (write-policy, traversal, backtick/$(), git push, redirect, rm, sed -i, sqlite3-мутации, python-мутации, фон &, whitelist, кэш-инвалидация ролей)
- MCP: initialize/tools/list/7 инструментов (register_run, upsert_artifact, kv, get_state)
- pantheon-log: SessionStart регистрирует роль из `recipe_json.title` («Agent: oracle»), PostToolUse аудит, SessionEnd закрывает run
- Провайдер: live-каталог opencode_go 30 моделей; glm-5.3-flash/glm-5.3 → 200; deepseek-v4.1-flash → 400 (нужен Privacy=Global); mimo-v2.5 → 403
