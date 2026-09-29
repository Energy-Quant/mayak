# Архитектура «Маяк» — карта-граф

> Сгенерировано по данным Infigraph 3.2.16 (2347 символа, 104 файла, 340 call-edges).
> Репозиторий: `~/pantheon`, ветка `mayak-gpuix`.

---

## 1. Обзор: три слоя

```mermaid
graph TB
    subgraph L0["Phase 0 — Личности (config-only)"]
        ORACLE["oracle.md<br/>oracle-consult.yaml"]
        LIBRARIAN["librarian.md<br/>librarian-research.yaml"]
        CONDUCTOR["pantheon-conductor.md<br/>(промпт-кондуктор)"]
    end

    subgraph L1["Phase 1 — Плагин контроля"]
        HOOKS["hooks.json<br/>SessionStart / PreToolUse /<br/>PostToolUse / SessionEnd"]
        GUARD["guard.sh<br/>read-only enforcement"]
        LOG["pantheon-log.sh"]
        LIB["pantheon-lib.sh<br/>upsert_run, resolve_role"]
        MCP["pantheon_state.py<br/>7 MCP-инструментов"]
    end

    subgraph L2["Phase 2–4 — UI клиент"]
        MAYAK["mayak-ui (GPUIX)<br/>активный стек"]
        LEGACY["pantheon-ui (Tauri)<br/>legacy, reference"]
    end

    subgraph DATA[("Данные")]
        SESSIONS_DB[("sessions.db<br/>goose сессии")]
        PANTHEON_DB[("pantheon.db<br/>runs / artifacts / kv")]
        CONFIG["config.yaml"]
        TOML["pantheon.toml<br/>цепочки моделей"]
        RECIPES["recipes/*.yaml"]
        PROMPTS["prompts/*.md"]
    end

    subgraph EXT["Внешние сервисы"]
        GOOSE["goose serve<br/>ACP / WebSocket"]
        OPENCODE["OpenCode Go API<br/>/v1/usage, /v1/models"]
    end

    MAYAK --> GOOSE
    MAYAK --> DATA
    LEGACY --> GOOSE
    LEGACY --> DATA
    L1 --> PANTHEON_DB
    L1 --> SESSIONS_DB
    L0 --> RECIPES
    GOOSE --> SESSIONS_DB
    GOOSE --> CONFIG
    MCP --> PANTHEON_DB
    GUARD --> PANTHEON_DB
    LIB --> PANTHEON_DB
```

---

## 2. mayak-ui — внутренняя структура (активный стек)

```mermaid
graph TB
    subgraph ENTRY["Точка входа"]
        APP_TSX["app.tsx<br/>render(App)"]
    end

    subgraph CORE["Ядро"]
        APP["App.tsx<br/>роутинг, pendingSession,<br/>newChatToken, activeSessionId"]
        TOKENS["tokens.ts<br/>тема «Волна»"]
        ACP["acp.ts<br/>AcpSession: WS → goose serve<br/>session/new, load, prompt,<br/>tool_call, agent_thought_chunk"]
    end

    subgraph API["API-слой (Bun)"]
        DB["db.ts<br/>openSessions, openPantheon,<br/>listSessions, listSubagentChildren,<br/>contentBlocks, getPantheonOverview"]
        CFG["config.ts<br/>getConfigSummary, toggleExtension,<br/>setActiveModel, getAgentChains,<br/>saveAgentChain, listPromptFiles"]
        GSRV["gooseServer.ts<br/>start / stop goose serve<br/>freePort, baseOrigins"]
        CATALOG["catalog.ts<br/>getProviderCatalog,<br/>validateChainStep"]
        LIMITS["limits.ts<br/>getOpencodeUsage"]
        CLIP["clipboard.ts<br/>clipboardImage (wl-paste)"]
        ATTACH["attachments.ts<br/>stageAttachment, readFileBytes,<br/>compressImageBytes"]
    end

    subgraph UI["Компоненты"]
        CHAT["Chat.tsx<br/>ChatPage: лента, ввод,<br/>rail (todos + subagents),<br/>ctx-meter"]
        SIDEBAR["Sidebar.tsx<br/>навигация, список чатов"]
        SETTINGS["Settings.tsx<br/>9 вкладок: Модели, UI, Чат,<br/>Внешний вид, Программы и др."]
        CHAIN["ChainEditor.tsx<br/>редактор цепочек моделей"]
        SUBSTREAM["SubagentStream.tsx<br/>live-стрим субагента"]
        SPLIT["SplitPane.tsx<br/>resizable rail"]
        PANEL["PantheonPanel.tsx<br/>обзор runs/artifacts"]
        USAGE["UsageBar.tsx<br/>OpenCode лимиты"]
        PAGES["SimplePages.tsx<br/>History, Recipes"]
        APPS["AppsPage.tsx"]
        SCHED["Scheduler.tsx"]
        AGENT_SET["AgentSettings.tsx"]
        MD["md.tsx<br/>markdown + toolRender"]
    end

    APP_TSX --> APP
    APP --> CHAT
    APP --> SIDEBAR
    APP --> SETTINGS
    APP --> PAGES
    APP --> TOKENS

    CHAT --> ACP
    CHAT --> DB
    CHAT --> CFG
    CHAT --> CATALOG
    CHAT --> LIMITS
    CHAT --> CLIP
    CHAT --> ATTACH
    CHAT --> MD
    CHAT --> USAGE

    SIDEBAR --> DB
    SETTINGS --> CFG
    SETTINGS --> CATALOG
    CHAIN --> CFG
    CHAIN --> CATALOG
    SUBSTREAM --> DB
    PANEL --> DB
    APPS --> DB
    APPS --> CFG
    SCHED --> DB
    AGENT_SET --> CFG
    AGENT_SET --> CATALOG

    ACP --> GSRV
    ACP --> DB
```

---

## 3. Потоки данных

```mermaid
sequenceDiagram
    participant U as Пользователь
    participant CH as ChatPage
    participant AC as AcpSession
    participant GS as goose serve
    participant SA as Субагент
    participant DB as sessions.db

    U->>CH: ввод сообщения
    CH->>AC: prompt(text, images, paths)
    AC->>GS: session/prompt (WebSocket)
    GS-->>AC: session/update (stream)
    AC-->>CH: onMessage (agent/thinking/tool)
    
    Note over GS,SA: delegate → субагент
    GS->>SA: spawn (delegate)
    SA-->>GS: tool_call _meta.subagent_session_id
    GS-->>AC: tool_call (delegate)
    AC-->>CH: subagentSessionId → rail
    
    CH->>DB: listSubagentChildren(sid)
    DB-->>CH: SubagentRow[]
    CH->>CH: poll каждые 3с
```

---

## 4. Plugin-слой (Phase 1)

```mermaid
graph LR
    subgraph HOOKS["Триггеры"]
        SS["SessionStart"]
        PTU["PreToolUse"]
        POU["PostToolUse"]
        SE["SessionEnd"]
    end

    subgraph SCRIPTS["Скрипты"]
        GUARD["guard.sh<br/>whitelist путей,<br/>read-only для oracle/librarian"]
        LOG["pantheon-log.sh"]
        LIB["pantheon-lib.sh<br/>upsert_run, resolve_role"]
    end

    subgraph MCP_TOOLS["MCP pantheon_state.py"]
        T1["pantheon_get_state"]
        T2["pantheon_kv_get / kv_set"]
        T3["pantheon_list_artifacts"]
        T4["pantheon_log_event"]
        T5["pantheon_register_run"]
        T6["pantheon_upsert_artifact"]
    end

    SS --> LIB
    PTU --> GUARD
    POU --> LOG
    SE --> LIB
    GUARD --> PANTHEON_DB
    LIB --> PANTHEON_DB
    MCP_TOOLS --> PANTHEON_DB
```

---

## 5. Слои конфигурации (кто кого читает)

```mermaid
graph TD
    TOML["pantheon.toml<br/>источник цепочек моделей"] -->|читает UI| CHAIN_UI["ChainEditor"]
    TOML -.->|TODO: автосинк| FRONT["agents/*.md frontmatter"]
    TOML -.->|TODO: автосинк| RECIPES_Y["recipes/*.yaml goose_model"]
    
    FRONT -->|читает delegate| DELEGATE["goose delegate"]
    RECIPES_Y -->|читает goose| DELEGATE
    
    CONFIG_Y["config.yaml"] -->|читает| GSRV2["goose serve"]
    CONFIG_Y -->|читает UI| CFG_UI["Settings"]
    
    PROMPTS_MD["prompts/*.md"] -->|читает| GSRV2
    PROMPTS_MD -->|редактирует UI| PROG_TAB["ProgramsTab"]

    style TOML fill:#f9f,stroke:#333
    style FRONT fill:#ff9,stroke:#333
    style RECIPES_Y fill:#ff9,stroke:#333
```

---

## 6. Языки и размер (Infigraph)

| Язык | Файлов | Символов |
|------|--------|----------|
| tsx | 41 | 684 |
| typescript | 21 | — |
| json | 12 | 55 |
| rust | 7 | — |
| markdown | 6 | 41 |
| bash | 5 | 45 |
| yaml | 4 | 541 |
| sql | 2 | 6 |
| python | 1 | 15 |

**Hub-функции (наибольший fan-in):**
1. `getConfigSummary` — 8 callers
2. `db()` (MCP) — 7
3. `config_path` (Rust) — 7
4. `openPantheon` — 6
5. `configPath` / `readCfg` — 5

**Горячие файлы (по символам):**
1. `Chat.tsx` (mayak-ui) — 71
2. `api/db.ts` — 70
3. `acp.ts` — 64
4. `api/config.ts` — 61
5. `ChainEditor.tsx` — 55

---

## 7. Схема данных (SQL)

```mermaid
erDiagram
    SESSIONS ||--o{ SUBAGENT : "parent_session_id"
    SESSIONS {
        TEXT id PK
        TEXT name
        TEXT session_type "user | acp | sub_agent"
        TEXT parent_session_id FK
        TEXT content_json
        INT total_tokens
    }
    RUNS {
        TEXT session_id PK
        TEXT role "oracle | librarian | goose"
        TEXT status "running | done"
        TEXT model
    }
    ARTIFACTS {
        TEXT path PK
        TEXT kind "plan | digest | analysis"
        TEXT topic
        TEXT run_session_id FK
    }
    KV {
        TEXT key PK
        TEXT value
    }
```

---

## 8. Принцип работы (кратко)

1. **Запуск:** `app.tsx` → GPUIX render → `App.tsx` монтирует роутер.
2. **Чат:** `ChatPage` автоконнектится через `AcpSession.start()` → spawn `goose serve` (reuse живого) → WS handshake с `--allowed-origin`.
3. **Сообщения:** `prompt()` → `session/prompt` → stream `session/update` → `onMessage` → React state → markdown рендер.
4. **Субагенты:** `tool_call` с `_meta.subagent_session_id` → rail poll `listSubagentChildren(sid)` каждые 3с.
5. **Вложения:** Ctrl+V / drop / file picker → `stageAttachment` → путь в тексте или image-блок ACP.
6. **Конфиги:** Settings/ChainEditor пишут `config.yaml` / `pantheon.toml` через `api/config.ts` (с бэкапом).
7. **Plugin:** hooks ловят сессии → `guard.sh` проверяет read-only → `pantheon_state.py` пишет в `pantheon.db`.

---

## 9. Известные долги (из графа и плана)

| # | Проблема | Где видно |
|---|----------|-----------|
| 1 | `saveAgentChain` не синкает frontmatter + recipes | config.ts → TOML пишется, md/yaml — нет |
| 2 | 37 сирот `parent_session_id=NULL` | sessions.db, listSubagentChildren не находит |
| 3 | file-deps не резолвит импорты (SCIP enrichment в фоне) | infigraph file-deps = 0 |
| 4 | `ui/pantheon-ui` (Tauri legacy) дублирует mayak-ui | два UI-стека в одном репо |

---

*Сгенерировано: 2026-09-29 · Инструмент: Infigraph 3.2.16 + ручной анализ*
