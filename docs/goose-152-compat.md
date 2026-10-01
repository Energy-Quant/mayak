# Аудит совместимости: Goose 1.52.0 ↔ «Маяк»

> Дата: 2026-10-01. Только read-only анализ, код не менялся.
> **Источники фактов** (не домыслы):
> - `goose --help`, `goose serve --help`, `goose session --help`, `goose run --help`, `goose recipe --help`, `goose schedule --help`, `goose gateway --help`, `goose acp --help`, `goose skills --help`, `goose plugin --help` — реальный бинарь 1.52.0 (`~/.local/bin/goose`, собран из main 23.09.2026);
> - `strings` бинаря: список ACP-методов (`session/*`), типов `session/update`, slash-команд, режимов `GooseMode`, DTO кастомного диспатча;
> - `@agentclientprotocol/sdk` (v2, в `ui/mayak-ui/node_modules`): типы `UsageUpdate`, `AvailableCommand`, `ClientCapabilities`, полный union `SessionUpdate`;
> - Код Маяка: `ui/mayak-ui/src/acp.ts`, `api/{gooseServer,db,config,catalog,limits,attachments}.ts`, `components/{Chat,Settings,Extensions,Scheduler,SimplePages,AppsPage,Auth,Keyboard,SubagentStream,UsageBar}.tsx`, `plugin/hooks/hooks.json`.
>
> **Обозначения статуса:** ✅ полностью · ⚠️ частично · ❌ нет · ⚪ вне scope UI (CLI-only, осознанно не переносится).
>
> **Приоритеты:** P0 — ломает работу/безопасность или противоречит аксиоме «поддерживать ВСЕ фичи Goose»; P1 — важно для паритета; P2 — желательно; P3 — низкий.

---

## A. ACP / протокол

ACP-методы, которые принимает goose 1.52 (из строки диспатча бинаря `initialize session/new session/load session/fork session/prompt session/cancel session/close session/list session/delete session/set_config_option authenticate logout` + `session/set_mode` + нестабильный `_goose/unstable/session/steer` + кастомный `crates/goose/src/acp/server/custom_dispatch.rs`).

| Фича Goose 1.52 | Статус | Где реализовано / чего не хватает | Приоритет |
|---|---|---|---|
| `initialize` (protocolVersion, clientInfo) | ✅ | `acp.ts` `AcpSession.start()` — `initialize` protocolVersion=1, clientInfo mayak-ui | — |
| `clientCapabilities` (fs, terminal, elicitation, configOptions, auth) | ⚠️ | `acp.ts` шлёт `clientCapabilities: {}` — пустой. goose не будет слать `fs/read_text_file`, terminal-запросы, elicitation, recipe-parameter requests («recipe requires parameters but the client does not support recipeParameterRequests») | P2 |
| `session/new` (cwd, mcpServers) | ✅ | `acp.ts start()` — `{cwd, mcpServers: []}`; profile-расширения грузятся (нет `--no-profile`) | — |
| `session/load` (replay истории) | ✅ | `acp.ts start(workingDir, loadId)` + `load()`; отдельно обработан нюанс, что ответ не возвращает `sessionId` (берётся запрошенный) | — |
| `session/prompt` (text + image-блоки + файлы) | ✅ | `acp.ts prompt()` — text/image-блоки, staged-пути документов, `[imgs]`-реестр | — |
| `session/cancel` | ✅ | `acp.ts cancel()` + кнопка в Chat (строка ~1059) | — |
| `session/fork` (разветвление истории) | ❌ | Не вызывается; нет UI «ветка чата». CLI `--fork` у goose есть | P2 |
| `session/list` (ACP-источник сессий) | ⚠️ | Маяк читает `sessions.db` напрямую (`api/db.ts listSessions/listSubagentChildren`) — функциональнее, но сам ACP-метод не используется (не критично) | P3 |
| `session/close` | ❌ | `stop()` убивает процесс `goose serve` вместо аккуратного закрытия сессии (`killServer=true`); при `disconnect()` просто рвётся WS | P2 |
| `session/delete` | ❌ | Нет удаления сессий (в History только открытие) | P2 |
| `session/set_mode` (режимы через ACP, `availableModes`/`currentModeId`) | ❌ | Маяк пишет `GOOSE_MODE` в `config.yaml` (`api/config.ts setGooseMode`) вместо ACP `session/set_mode`; changes для живой сессии не применяются, `current_mode_update` не обрабатывается | **P0** (см. B/режимы) |
| `session/set_config_option` (model / thought_level на сессию) | ❌ | Не вызывается. Смена модели в UI (`setActiveModel`) пишет config.yaml —生效 только для новых сессий; `config_option_update` не обрабатывается. goose: DTO `SetConfigOptionRequest` (model, model_config, thought_level) | P1 |
| `_goose/unstable/session/steer` (правка задания на лету) | ❌ | Во время стрима send() заблокирован (`status !== "ready"`), есть только cancel. Строки бинаря: «Interrupt, what should goose work on instead?» | P2 |
| `authenticate` / `authMethods` (OAuth device/browser flow для провайдеров) | ❌ | Пустые clientCapabilities + нет обработки `authenticate`; вкладка Auth — пустое состояние (`components/Auth.tsx`). Для API-key-провайдеров Маяка не критично, для chatgpt_codex/gemini-cli OAuth — блокер | P2 |
| Кастомный диспатч (`load_skill`, `view_session`, `list_sessions`, `interrupt_agent`, `manage_extensions`, apps, `todo`, `analyze`, `send_message`…) | ❌ | `crates/goose/src/acp/server/custom_dispatch.rs` — Маяк не вызывает ни одного кастомного метода | P2 |
| Обработка входящих `session/request_permission` | ⚠️→❌ | `acp.ts` (строка 214): **всегда** отвечает `{outcome:"selected", optionId:"allow_once"}` — пользовательский диалог разрешений отсутствует, режимы approve/smart_approve фактически выключены | **P0** (см. «Критичные пробелы») |
| Транспорт: WS + `GOOSE_SERVER__SECRET_KEY` + `?token=` | ✅ | `api/gooseServer.ts start()` — секрет генерируется, `ws_url` с token; `/status` readiness-poll; stderr → `~/.local/state/mayak-ui/goose-serve.log` | — |
| Watchdog/reconnect сессии | ✅ | `acp.ts startWatchdog/watchdogTick` — health `/status` каждые 10 c, backoff до 8 c, resurrect сессии | — |

### Входящие `session/update` (типы из union ACP SDK и бинаря)

| Тип обновления | Статус | Комментарий | Приоритет |
|---|---|---|---|
| `agent_message_chunk` | ✅ | `acp.ts handleSessionUpdate` | — |
| `agent_thought_chunk` | ✅ | merge чанков в thinking-сообщения | — |
| `user_message_chunk` (replay при load) | ✅ | рендерит «мои» сообщения из истории | — |
| `tool_call` / `tool_call_update` | ✅ | в т.ч. `_meta.subagent_session_id`, сырой `rawInput` не затирается, todo-парсинг | — |
| `usage_update` (used/size) | ✅ | `onUsage` → ctx-метр в топбаре Chat | — |
| `usage_update.cost` (Cost: сумма/валюта) | ❌ | поле `cost` игнорируется (берётся только used/size) | P2 |
| `available_commands_update` (список slash-команд) | ❌ | не обрабатывается → нет автокомплита/палитры команд (см. «Slash-команды») | P1 |
| `current_mode_update` | ❌ | игнорируется → индикатор режима не обновляется | P1 |
| `config_option_update` (model/thought_level) | ❌ | игнорируется | P1 |
| `session_info_update` (автоназвание сессии, title) | ❌ | игнорируется → новые названия чатов появляются только после чтения `sessions.db` заново | P3 |
| `compaction_update` / `compaction_summary_chunk` | ❌ | нет индикатора «идёт сжатие контекста» (только текстовые артефакты компакта) | P3 |
| `notice` | ❌ | молча отбрасывается (default-ветка не найдёт plan) | P3 |
| `tool_call_content_chunk` (стриминг вывода инструмента) | ❌ | вывод инструмента виден только в финальном `tool_call_update` | P2 |
| `terminal_update` / shell-чанки | ⚠️ | вывод shell-команд виден в tool_out ретроспективно (db.ts `summarizeToolOutput`); потоковый вывод — нет | P2 |
| `plan` / `todo write` (чек-лист) | ✅ | default-ветка `plan.entries` + парсинг `todo write` через `parseTodos` | — |

---

## B. Сессии

| Фича Goose 1.52 | Статус | Где реализовано / чего не хватает | Приоритет |
|---|---|---|---|
| Новая сессия / переключение | ✅ | Chat: «Новый чат» → чистый `session/new`; `chatSession`/`lastSid` reuse | — |
| Открытие истории (`session/load`) | ✅ | History/Sidebar → `open-session`/`load-session` → `AcpSession.load()`; `user_message_chunk` replay | — |
| Список сессий | ✅⚠️ | `api/db.ts listSessions` (sessions.db, LIMIT 100, фильтры на фронте); нюанс: `parent_session_id IS NULL` у большинства субагентов-сирот | — |
| Переименование / архив / unarchive | ❌ | goose (Desktop-RPC): `RenameSessionRequest`, `ArchiveSessionRequest`, `UnarchiveSessionRequest`; в History-UI Маяка нет ни rename, ни archive (в запросе используется только `archived_at IS NULL`) | P2 |
| Экспорт сессии | ❌ | `goose session export` (JSON); ACP/Desktop RPC `session/export`; в UI нет | P2 |
| Импорт сессии (JSON, Claude Code/Codex/Pi `.jsonl`, Nostr-share) | ❌ | `goose session import` — в Маяке нет (только CLI) | P3 |
| Fork сессии | ❌ | CLI `--fork`, ACP `session/fork` | P2 |
| `session diagnostics` | ❌ | Только CLI | P3 |
| Удаление сессий | ❌ | CLI `session remove`, ACP `session/delete` | P2 |
| Режимы работы (GooseMode) | ⚠️❌ | См. таблицу ниже — **режимы в UI расходятся с goose 1.52** | **P0** |
| Автоназвание сессий (`session_naming`, `GOOSE_DISABLE_SESSION_NAMING`) | ✅⚠️ | goose генерирует названия сам; Маяк читает `name` из sessions.db. Живые обновления (`session_info_update`) не подхватываются | P3 |

### Режимы `GOOSE_MODE`: Маяк vs Goose 1.52

Факт: в бинаре 1.52 enum `GooseMode` содержит варианты `auto`, `approve`, `smart_approve`, `chat` (строка `GooseModeapprovesmart_approve`, configure-экран: Auto/Approve/Smart Approve/Chat Mode). Строка `chat_only` в бинаре **отсутствует** (0 вхождений в `strings`), есть только текст системного промпта «you are in the chat only mode» (описание режима chat).

| Режим в UI Маяка (`Settings.tsx MODES`) | Что пишется в config.yaml | Соответствие goose 1.52 | Проблема |
|---|---|---|---|
| «Автономный» | `auto` | ✅ Auto Mode | — |
| «Вручную» | `approve` | ✅ Approve Mode | Режим есть, но см. P0 про permission-диалог |
| «Утверждать» (desc: «по уровню риска») | `chat` | ❌ **не соответstвет**: значение `chat` = Chat Mode («без инструментов вообще»), а описание — это Smart Approve | Выбор «Утверждать» на самом деле запрещает инструменты. Нужен `smart_approve` |
| «Планировать» | `chat_only` | ❌ значения нет в goose 1.52 (0 строк в бинаре; парсер: «Failed to parse GooseMode variant:») | Режим неRecognized goose → фолбэк/ошибка |

Итого: из четырёх кнопок Маяка две ведут не туда, а `smart_approve` (настоящий «Утверждать по риску») в UI отсутствует. Независимо от этого, см. критичный пробел №2 — через ACP Маяка approve-режим всё равно не спрашивает.

---

## C. Субагенты

| Фича Goose 1.52 | Статус | Где реализовано / чего не хватает | Приоритет |
|---|---|---|---|
| Делегирование (orchestrator extension, `delegate`) | ✅ | На стороне goose (config.yaml orchestrator enabled) — Маяк не мешает | — |
| Обнаружение субагента | ✅ | `acp.ts`: `_meta.subagent_session_id` в `tool_call` → `onSubagentEvent` (событийный триггер rail, без poll) | — |
| Иерархия детей | ✅ | `db.ts listSubagentChildren(parentId)` — прямой SQL по `parent_session_id`, `session_type='sub_agent'` | — |
| Просмотр стрима субагента | ⚠️ | `SubagentStream.tsx` — **поллинг sessions.db каждые 2 с** (`listSubagentMessages`, последние 80), не живой ACP-стрим. goose не публикует субагент-сессии в родительский ACP-поток (Desktop читает так же) | P3 (приемлемо) |
| Живой прогресс (токены, running) | ✅⚠️ | токены из `total_tokens` sessions.db; running-флаг из pantheon.db runs | — |
| `interrupt_agent` (остановить субагента) | ❌ | Кастомный метод диспатча не вызывается; cancel субагента из rail отсутствует | P2 |
| Изображения субагенту | ⚠️ | goose `delegate` передаёт только текст. Маяк обходит: реестр `sessionImagePaths` + `[imgs]` в prompt + автоконтекст `session/prompt` к субагенту при tool_call delegate (`acp.ts`, автоконтекст-блок). Хак работает, но не паритет | P2 |
| `GOOSE_SUBAGENT_MAX_TURNS` | ✅ | наследуется из env (`process.env` в `Bun.spawn` gooseServer.ts) | — |
| Визуализация токенов по ролям | ❌ | `db.ts getPantheonOverview`: `role_stats.tokens = null` — «в runs нет usage-колонок (schema.sql)» | P2 |

---

## D. Модели / контекст / usage

| Фича Goose 1.52 | Статус | Где реализовано / чего не хватает | Приоритет |
|---|---|---|---|
| ctx-метр (used/size из `usage_update`) | ✅ | Chat.tsx `onUsage` → `${fmtTokens(ctx.tokens)} ткн` в топбаре | — |
| Порог автосжатия (`GOOSE_AUTO_COMPACT_THRESHOLD`) | ✅⚠️ | читается и показывается (`getConfigLimits`); правка из UI — «позже» (надпись в AppTab) | P1 |
| Ручное сжатие `/compact` | ✅ | `Chat.tsx compact()` → `session/prompt("/compact")` — goose исполняет slash-команду в prompt | — |
| Индикатор компакта (`compaction_update`) | ❌ | нет отдельного UI-состояния «goose компактит…» | P3 |
| Лимит ходов `GOOSE_MAX_TURNS` | ✅⚠️ | чтение+показ (`AppTab`), редактирование из UI отсутствует | P1 |
| Каталог моделей и context_limit | ✅ | `api/catalog.ts`: MERGE API `/v1/models` + file-is-truth `~/.config/goose/opencode-go-models.json` (`loadContextTruth`) | — |
| Валидация шага цепочки | ✅ | `catalog.ts validateChainStep` (мини-запрос, маппинг ошибок 403/400) | — |
| Цепочки моделей (primary+fallbacks) | ✅ | `config.ts getAgentChains/saveAgentChain` (pantheon.toml) + автосинк в frontmatter/recipe (`syncModelToRuntime`) | — |
| Переключение активной модели **в живой сессии** | ❌ | goose поддерживает `session/set_config_option` (model) и slash `/model` на лету; Маяк пишет config.yaml → новая модель подхватится только новой сессией | **P1** |
| Thought level / `GOOSE_THINKING_EFFORT` | ❌ | В configure/ACP есть thinking_effort (DTO `thought_level`); в UI Маяка нет вообще | P2 |
| Стоимость (`usage_update.cost`, `GOOSE_CLI_SHOW_COST`) | ❌ | Cost-структура игнорируется | P2 |
| Лимиты провайдера (OpenCode Go 5ч/нед/мес) | ✅ | `api/limits.ts getOpencodeUsage` + `UsageBar.tsx` (опрос 30 с) — это сверх-фича Маяка, у Goose такового нет | — |
| `GOOSE_CONTEXT_LIMIT` / `GOOSE_PREDEFINED_MODELS` | ✅⚠️ | учтено в слое каталога (display-only по PR #9769 — истина в opencode-go-models.json); в UI бейджи context_limit в ModelsTab не рисуются (известный долг) | P3 |

---

## E. Вложения / мультимодальность

| Фича Goose 1.52 | Статус | Где реализовано / чего не хватает | Приоритет |
|---|---|---|---|
| Картинки → ACP image-блоки | ✅ | `acp.ts prompt(images)`; `PromptCapabilities.image` объявлен goose | — |
| Стейджинг документов (путь в тексте) | ✅ | `api/attachments.ts stageAttachment` → `~/.cache/goose/mayak-attachments/`, лимит 25 МБ, паритет `stage_attachment`/`appendDroppedFilePaths` | — |
| Сжатие картинок (≤1024px JPEG q85) | ✅ | `attachments.ts compressImageBytes` (ImageMagick; нет magick → оригинал) | — |
| Вставка Ctrl+V / drag&drop / скрепка | ✅ | Chat + `api/clipboard` (wl-paste), `onFileDrop` GPUIX | — |
| Превью чипы, лимит вложений | ✅ | chips, превью 72×72 | — |
| Аудио-вложения (`PromptCapabilities.audio`) | ❌ | goose объявляет audio в prompt capabilities; Маяк шлёт только image/text | P3 |
| PDF / embeddedContext | ❌ | не отправляются | P3 |
| Извлечение изображений из PDF/файлов (pdf_tool, docx_tool) | ⚠️ | это фичи расширений (computercontroller) — работают в чате через goose, отдельного UI нет | P3 |

---

## F. Конфиги / recipes / планировщик

| Фича Goose 1.52 | Статус | Где реализовано / чего не хватает | Приоритет |
|---|---|---|---|
| Просмотр config.yaml (провайдеры, расширения, режим) | ✅ | `config.ts readSummary/getConfigSummary` | — |
| Смена активной модели/провайдера (запись) | ✅⚠️ | `setActiveModel` — с бэкапом;生效 для новых сессий (см. D) | P1 |
| Редактор промптов (`~/.config/goose/prompts/*.md`) | ✅ | `config.ts PROMPT_FILES` (7 файлов, whitelist) + `ProgramsTab` (бэкап `.bak`) | — |
| Лимиты (`GOOSE_MAX_TURNS`, `GOOSE_AUTO_COMPACT_THRESHOLD`) | ⚠️ | только чтение+показ, нет записи из UI | P1 |
| Список рецептов | ✅ | `config.ts listRecipes` + страница Recipes (паритет `goose recipe list`) | — |
| `goose recipe validate` / `deeplink` / `open` | ❌ | только CLI; в Recipes-UI нет валидации/запуска | P3 |
| Запуск рецепта с параметрами (recipe params через ACP) | ❌ | goose: `recipeParameterRequests` требует поддержки клиента (см. clientCapabilities) — Маяк параметрические рецепты не запускает | P2 |
| Рецепт-слэш-команды (`SetRecipeSlashCommandRequest`, `recipe_slash_command.rs`) | ❌ | в ACP приходят через `available_commands_update` — не обрабатываются | P1 |
| **Планировщик**: `--enable-scheduler` | ✅ | `gooseServer.ts` передаёт флаг при спавне | — |
| Планировщик: просмотр jobs | ✅ | `db.ts getScheduledJobs` (чтение `~/.local/share/goose/schedule.json`) + `Scheduler.tsx` (статусы, счётчики) | — |
| Планировщик: add / remove / pause / run-now | ❌ | goose: `goose schedule add/list/remove/run-now` + RPC `CreateScheduleRequest`/`PauseScheduleRequest`/`RunScheduleNowRequest`; в Scheduler-UI действий нет (только copy id) | P1 |
| Deeplink-рецепты (`goose://recipe`) | ❌ | — | P3 |
| `GOOSE_RECIPE_GITHUB_REPO` (тяга рецептов из GitHub) | ❌ | в UI нет настройки | P3 |

---

## G. Расширения / MCP / плагины / скиллы

| Фича Goose 1.52 | Статус | Где реализовано / чего не хватает | Приоритет |
|---|---|---|---|
| Toggle расширений (config.yaml `extensions.*.enabled`) | ✅ | `config.ts toggleExtension` (бэкап `.yaml.bak-mayak`) + `Extensions.tsx` (оптимистичный toggle с откатом) | — |
| Просмотр секций bundled/other | ✅ | `Extensions.tsx` (DEFAULT_EXTS + остальные) | — |
| Добавление расширения (stdio / streamable-http / builtin) | ❌ | goose: `--with-extension`, `--with-streamable-http-extension`, `--with-builtin`, `/extension`, `/builtin`, `AddConfigExtensionRequest`; в UI только toggle существующих | P2 |
| Удаление расширения | ❌ | `RemoveConfigExtensionRequest` / CLI remove | P3 |
| Настройка параметров расширения (env, timeout) | ❌ | нет UI-редактора секции расширения | P3 |
| `goose plugin install/update` (git-плагины) | ❌ | CLI-only; в Маяке plugin слоя свой (`plugin/`), но установка/обновление git-плагинов goose из UI недоступна | P2 |
| Свои hooks (PreToolUse guard и др.) | ✅ | `plugin/hooks/hooks.json` — SessionStart/PreToolUse(matcher, on_failure:block)/PostToolUse/SessionEnd; события совпадают с набором goose 1.52 в бинаре (там также есть `UserPromptSubmit`, `Notification`, `Stop` — не используются) | P3 (расширение своих hooks — по плану) |
| MCP-инструменты Маяка (pantheon-state) | ✅ | config.yaml extension `pantheon-state` (stdio python3) + `plugin/mcp/pantheon_state.py` | — |
| MCP servers в сессию (`session/new.mcpServers`) | ⚠️ | всегда `[]` — серверные MCP-инъекции на сессию не используются (глобальные из profile работают) | P3 |
| `goose mcp` (bundled MCP-серверы) | ⚪ | CLI-only | — |
| Скиллы: просмотр/включение (`goose skills list`, `/skills`) | ⚠️ | расширение `skills` включается в Extensions (toggle); страницы скиллов/`/skills` нет | P2 |
| Apps (create/iterate/delete/export) | ⚠️ | `AppsPage.tsx` — список + открытие (`openApp`/`listStoredApps`); создание/редактирование идут только инструментами расширения apps в чате; delete/export/import UI нет | P3 |
| Вкладка «Авторизация» | ❌ | `Auth.tsx` — пустое состояние («появится позже»); goose: `authenticate`, keyring-секреты, provider auth status | P2 |
| Вкладка «Клавиатура» | ❌ | `Keyboard.tsx` — пустое состояние (нет данных о хоткеях в конфигах goose) | P3 |

---

## H. Slash-команды

Фактический список ACP slash-команд goose 1.52 (строки бинаря `crates/goose/src/acp/server/slash_commands.rs`):

`/compact`, `/clear`, `/new`, `/status`, `/skills`, `/help`, `/model [name]` и `/model --provider …`, `/mode <name>`, `/prompts`, `/prompt <n>`, `/extension <command>`, `/builtin <names>`, `/t` (тема), `/t <name>`, `/r` (полный tool output), `/edit [text]`, `/goal`/`/goal off`, `/grind`/`/grind off`, `/exit|/quit`, + рецепт-слэш-команды.

| Фича | Статус | Где / чего не хватает | Приоритет |
|---|---|---|---|
| `/compact` (ручное сжатие) | ✅ | кнопка «Сжатие» в Chat → `prompt("/compact")` | — |
| Приём `available_commands_update` (каталог команд от goose) | ❌ | `handleSessionUpdate` не знает этот тип → нет данных для палитры; в т.ч. рецепт-команды | P1 |
| Автокомплит / палитра slash-команд при вводе `/` | ❌ | ввод в Chat — голый textarea (`input`/`onChange`), никакой обработки префикса `/` | P1 |
| `/status`, `/model`, `/mode`, `/skills`, `/clear`, `/new`, `/goal`… | ⚠️ | **работают при ручном вводе** (goose исполняет slash-команды внутри `session/prompt` — тот же механизм, что у кнопки `/compact`), но UI-точек входа нет | P1 |
| `/r`, `/t` (терминальные переключатели) | ❌ | осмысленны только в TUI; в GUI-Маяке аналоги не реализованы | P3 |
| `/edit` (открыть `$EDITOR`) | ⚪ | нет смысла в GPUIX-окне | — |

---

## I. Безопасность / origin / permissions

| Фича Goose 1.52 | Статус | Где реализовано / чего не хватает | Приоритет |
|---|---|---|---|
| `--allowed-origin` (exact-list, заменяет loopback-дефолт) | ✅ | `gooseServer.ts baseOrigins()` + передача origins аргументом; секрет в query token | — |
| `GOOSE_SERVER__SECRET_KEY` (обязательный секрет) | ✅ | генерируется в `start()`, не используется `--dangerously-unauthenticated` — правильно | — |
| TLS (`--tls`, cert/key) | ⚪ | localhost-only, не требуется | — |
| Диалог разрешений (`session/request_permission`: allow_once/allow_always/reject_once/reject_always) | ❌ | `acp.ts:214` — **авто-ответ `allow_once` на всё**, без UI. Итог: (1) approve/smart_approve не спрашивают человека; (2) «Планировать»/chat-режим тоже зависит от корректности режима | **P0** |
| Per-tool permissions (`always_allow/ask_before/never_allow`, permission.yaml) | ❌ | нет UI (`SetToolPermissionsRequest`); goose-инструмент «permission judge» работает только если клиент показывает диалоги | P1 |
| Режим-маппинг (см. таблицу в B) | ❌ | `chat_only` невалиден, `smart_approve` отсутствует, описание «Утверждать» привязано к `chat` | **P0** |
| Guard-слой Маяка (read-only для Оракула/Библиотекаря) | ✅ | `plugin/` hooks + `guard-rs` — экосистемная надстройка, параллельна goose-режимам | — |
| Обновление goose (`goose update`) | ⚪⚠️ | CLI есть; **известный урок: откатывает ручную сборку 1.52**. Маяк не предупреждает/не блокирует эту команду, если пользователь запустит её в терминале | P3 (док-предупреждение) |

---

## J. Observability / диагностика

| Фича Goose 1.52 | Статус | Где реализовано / чего не хватает | Приоритет |
|---|---|---|---|
| Свой лог-слой Маяка | ✅ | `logger.ts` + `~/.local/state/mayak-ui/goose-serve.log` (stderr sidecar) | — |
| Аудит событий | ✅ | pantheon.db `kv` (`kvSet`: chain-edit и пр.), `runs` | — |
| Токены по ролям | ❌ | `role_stats.tokens = null` (в schema.sql нет usage-колонок) | P2 |
| `goose doctor` / `info` (диагностика setup) | ❌ | CLI-only; в UI нет кнопки самодиагностики | P3 |
| `session diagnostics` | ❌ | CLI-only | P3 |
| OTEL (OTLP env: logs/metrics/traces) | ⚪ | goose 1.52 поддерживает `OTEL_EXPORTER_OTLP_*`; Маяк не настраивает (и не мешает) | P3 |
| LLМ-логи запросов (`~/.local/state/goose/logs/llm_request.*.jsonl`) | ⚪ | включаются самим goose; Маяк их не читает (диагностический инструмент, не фича UI) | P3 |
| Цены/стоимость сессии | ❌ | см. D (`cost` игнорируется) | P2 |

---

## Прочие CLI-фичи Goose 1.52 (не ACP)

| Фича | Статус | Приоритет |
|---|---|---|
| `goose run` (`-t/-i`, `--output-format stream-json`, `--recipe`, `--params`, `--sub-recipe`, `--stats`, `--no-session`, `--container`, `--provider/--model` override) | ⚪ (CLI) | — |
| `goose session --fork/--edit/--history/--system/--max-turns/--container/--with-extension` | ⚪ | — |
| `goose gateway` (Telegram и др. платформы, pairing) | ⚪/❌ — в UI Маяка нет страницы gateway (наблюдаемость статуса) | P3 |
| `goose local-models` (GGUF/MLX, HF-загрузка, llama.cpp) | ❌ в UI | P3 |
| `goose term` (терминальная сессия), `goose review` (ревью диффа), `goose completion` | ⚪ | — |
| `goose update` (`--canary`, `--reconfigure`) | ⚪ (с оговоркой выше) | P3 |
| `goose skills list` | ⚠️ см. G | P2 |

---

# Критичные пробелы

**1. `session/request_permission` всегда авто-разрешается — approve-режим иллюзорен (P0).**
`acp.ts:214` жёстко отвечает `allow_once` на любой запрос разрешения. Пользователь никогда не видит диалог «разрешить/запретить», значит:
- `GOOSE_MODE=approve` (и будущий `smart_approve`) не защищают ничего — goose шлёт запрос, Маяк гасит его автоматически;
- это прямо противоречит смыслу режимов goose и ожиданию «Вручную» в настройках.
Нужен нормальный permission-UI (варианты allow_once/allow_always/reject_once/reject_always из `RequestPermissionRequest.options`) + возможность «запретить всегда».

**2. Маппинг режимов в UI не соответствует Goose 1.52 (P0).**
- кнопка «Утверждать» пишет `chat` → в goose это Chat Mode «без инструментов», а не smart-approve;
- кнопка «Планировать» пишет `chat_only` → такого варианта в `GooseMode` 1.52 нет (0 строк в бинаре, парсер: «Failed to parse GooseMode variant»);
- настоящий `smart_approve` в UI отсутствует.
Фикс: пересобрать список `MODES` по факту (`auto | approve | smart_approve | chat`), сверить описания с configure-экраном goose, и (желательно) перейти на ACP `session/set_mode` + обработку `current_mode_update`, чтобы режим менялся в живой сессии.

**3. Slash-команды фактически не интегрированы (P1, но для аксиомы — близко к P0).**
goose 1.52 шлёт `available_commands_update` (каталог команд, включая рецепт-команды) — Маяк этот тип не обрабатывает, автокомплита `/` нет, из команд UI знает только `/compact`. Команды *работают* при ручном наборе, но 90% функционала (включая `/model`, `/mode`, `/skills`, `/goal`) сокрыты. Это прямое нарушение аксиомы «поддерживать все фичи».

**4. Смена модели/режима не действует на живую сессию (P1).**
goose предлагает `session/set_config_option` (model, thought_level) и `session/set_mode` — Маяк пишет config.yaml. Пользователь меняет модель в Settings и получает старую модель до пересоздания сессии (что уже горело с ChainEditor/автосинком — тот же класс бага).

**5. Scheduler включён, но управление только чтением (P1).**
`--enable-scheduler` передаётся, jobs видны, но add/pause/run-now/remove недоступны — фича заявлена в goose, в Маяке наполовину отсутствует.

---

# Рекомендуемый порядок доделки

### Этап 1 — закрыть P0 (безопасность и корректность режимов)
1. **Permission-диалог**: обработчик `session_request_permission` → модалка/инлайн-карточка с опциями из запроса (allow_once/allow_always/reject_once/reject_always), дефолт фокуса — reject; лог решения в pantheon.db kv.
2. **Режимы**: таблица `MODES` → `auto | approve | smart_approve | chat` с описаниями из goose configure; валидация значения перед записью; показ текущего режима из `current_mode_update` (обработать тип в `handleSessionUpdate`).

### Этап 2 — slash-команды и живая конфигурация (P1)
3. Обработать `available_commands_update` → зеркало каталога команд в Chat.
4. Палитра автокомплита при вводе `/` (фильтр по `AvailableCommand.name/description`, Enter → отправка `/cmd …` как prompt).
5. Обработать `config_option_update` + подключить `session/set_config_option` для смены модели на лету (и `session/set_mode` вместо записи config.yaml — с фолбэком на yaml для новых сессий).
6. Правка лимитов `GOOSE_MAX_TURNS` / `GOOSE_AUTO_COMPACT_THRESHOLD` из AppTab (сейчас read-only) — плюс перезапуск/уведомление, что лимиты читаются при старте сессии.

### Этап 3 — паритет сессий и планировщика (P1–P2)
7. Scheduler: add/pause/unpause/run-now/remove (через `goose schedule` CLI-обёртку или RPC `CreateScheduleRequest`…), сессии джобы (`schedule sessions`).
8. Session management в History: rename, archive/unarchive, delete, fork (`session/fork`), export (JSON).
9. `session/close` перед kill sidecar (аккуратное завершение вместо убийства процесса).

### Этап 4 — углубление (P2)
10. Инструмент-permission UI (`always_allow/ask_before/never_allow`).
11. `usage_update.cost` + токены по ролям (расширить schema.sql pantheon.db usage-колонками → role_stats.tokens).
12. Стриминг tool-вывода (`tool_call_content_chunk`, terminal/shell чанки).
13. Skills-страница (`goose skills list` + `/skills`), добавление расширений (stdio/http/builtin), `goose plugin install/update`.
14. clientCapabilities (fs/terminal/elicitation/configOptions) — раскрывает recipe-parameter requests и штатный elicitation.
15. `session/steer` (unstable) — правка задания во время хода вместо cancel.
16. Thinking effort (`thought_level`) в настройках модели.

### Этап 5 — полировка (P3)
17. `session_info_update` (живые названия), `compaction_update`/`notice` (индикатор сжатия), audio-вложения, export/import `.jsonl`, diagnostics/doctor-кнопка, gateway/local-models страницы, документ-предупреждение про `goose update`.

---

## Приложение A. Проверочные команды (для регресс-аудита)

```bash
goose --version                        # 1.52.0
goose serve --help                     # флаги: --allowed-origin, --enable-scheduler, --tls, --dangerously-unauthenticated
strings -n 6 ~/.local/bin/goose | grep -oE "session/[a-z_]+" | sort -u    # ACP-методы
strings -n 6 ~/.local/bin/goose | grep -oE "chat_only|smart_approve"       # режимы (chat_only → 0)
```

## Приложение B. Полный список типов `session/update` в goose 1.52

`user_message_chunk`, `user_message`, `agent_message_chunk`, `agent_message`, `agent_thought_chunk`, `agent_thought`, `tool_call`, `tool_call_update`, `tool_call_content_chunk`, `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update`, `usage_update`, `notice`, `compaction_update`, `compaction_summary_chunk`, `terminal_update`, `plan` (через tool `todo write`).

Обрабатываются Маяком: **6 из 19** (message/thought/user chunk, tool_call, tool_call_update, usage_update) + plan/todos в default-ветке.
