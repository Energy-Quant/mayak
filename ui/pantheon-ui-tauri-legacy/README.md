# pantheon-ui (Phase 2 — скелет)

Tauri 2 клиент Пантеона: Rust-бэкенд + системный webview, тема DreamWave (3 палитры), нативные fallback-селекторы.

## Запуск (dev)
```bash
cd ui/pantheon-ui
pnpm install
pnpm tauri dev    # cargo tauri dev
```
Требует: cargo, tauri-cli 2, pnpm, webkit2gtk-4.1 (arch: `webkit2gtk-4.1`).

## Что уже в скелете
- `src/theme.css` — токены 3 тем: `dreamwave-night` (default), `tokyonight-storm`, `rosepine-moon`; цвета личностей сквозные
- `src/components/AgentSettings.tsx` — Экран 4: primary + fallback-ступени per agent (провайдер+модель селекты, кнопка «Проверить», пресеты)
- `src/components/PantheonRoleBadge.tsx` — индикатор личности (+ мигание при сработавшем fallback)
- `src/components/SplitPane.tsx` — каркас родитель|субагент (Esc закрывает правую панель)
- `src-tauri/src/pantheon.rs` — pantheon.toml I/O (атомарная запись, аудит в kv)
- `src-tauri/src/main.rs` — команды: get_agent_chains, save_agent_chain, get_provider_catalog (живой каталог opencode_go), validate_chain_step (мини-запрос, ловит 403/region), get_recent_runs, get_artifacts

## Дорожная карта до MVP
1. ACP: sidecar `goose serve` (tauri shell plugin) + `@aaif/goose-acp-client` в webview; чат-компонент
2. Split-view: live-стрим субагента по `_meta.subagent_session_id`
3. Панель: артефакты (plans/digests/analysis) с открытием markdown
4. Переключатель тем (data-theme) + контраст-тесты WCAG AA
5. PKGBUILD `pantheon-ui-bin`

## Контракт ACP (проверено по исходникам goose 1.51)
Desktop спавнит `goose serve` (127.0.0.1, порт+secret, опц. TLS) и общается по WebSocket через `@aaif/goose-acp-client` — наш клиент повторяет схему без изменений ядра.
