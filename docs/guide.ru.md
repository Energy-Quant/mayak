# Руководство пользователя «Маяк»

> Для чего это руководство: установка, запуск, ежедневная работа в чате, субагенты, вложения, режимы, Панель Маяка и настройки моделей.
> См. также: [README.md](README.md) (обзор) · [architecture.ru.md](architecture.ru.md) (как устроено) · [../AGENTS.md](../AGENTS.md) (правила репо).

**English version:** [guide.en.md](guide.en.md)

---

## 1. Установка

### Требования

| Компонент | Версия / зачем |
|---|---|
| [goose](https://github.com/block/goose) | **1.52.0** (ACP-протокол, режимы `auto/approve/smart_approve/chat`, `session/set_mode`) |
| [Bun](https://bun.sh) | рантайм mayak-ui (TypeScript/TSX без сборки) |
| Rust toolchain (`cargo`) | сборка guard-rs (`plugin/guard-rs`) |
| `jq`, `sqlite3`, `python3` | хуки плагина и MCP `pantheon_state.py` |
| Доступ к API-провайдеру | напр. OpenCode Go (ключи в `~/.config/goose/`, в репо не коммитятся) |

### Установка слоёв L0 + L1

```bash
cd ~/pantheon
./deploy.sh
```

Скрипт:
- копирует личности `agents/*.md` → `~/.agents/agents/`;
- копирует рецепты `recipes/*.yaml` → `~/.config/goose/recipes/`;
- ставит плагин `plugin/` → `~/.agents/plugins/pantheon/`;
- применяет схему `sql/schema.sql` к `~/.local/share/goose/pantheon.db`;
- при отсутствии файла пишет `~/.config/environment.d/90-goose-subagent.conf` с `GOOSE_SUBAGENT_MAX_TURNS=1000`.

После установки проверьте `~/.config/goose/config.yaml`:

```yaml
extensions:
  orchestrator:
    enabled: true          # без него delegate субагентов не работает
  pantheon-state:
    enabled: true
    type: stdio
    command: python3
    args: ["~/.agents/plugins/pantheon/mcp/pantheon_state.py"]
```

### Установка / запуск UI (L2)

```bash
cd ~/pantheon/ui/mayak-ui
bun install        # зависимости (GPUIX пинится парой @gpuix/react + @gpuix/native 0.10.0)
bun app.tsx        # окно «Маяк»
```

Миграции БД (при обновлении репо):

```bash
cd ~/pantheon && ./sql/migrate.sh   # применяет sql/migrations/* по user_version
```

---

## 2. Запуск: mayak-ui и goose serve

При старте UI сам поднимает sidecar:

1. `api/gooseServer.ts` спавнит `goose serve` с `--allowed-origin` (exact-list origin'ов + секрет) и `--enable-scheduler`;
2. секрет передаётся как `?token=` в WS-URL (`GOOSE_SERVER__SECRET_KEY`), readiness-poll `/status` до 25 с;
3. stderr sidecar'а пишется в `~/.local/state/mayak-ui/goose-serve.log`;
4. живой sidecar переиспользуется (без зомби-процессов), kill — только при ошибке старта.

Ручной запуск `goose serve` **не нужен** — окно чата автоконнектится (`AcpSession.start()` → `session/new`).

Если соединение упало:
- **watchdog** (в `acp.ts`) опрашивает `/status` каждые 10 с и делает reconnect с backoff до 8 с;
- в UI есть баннер ошибки + кнопка «повторить подключение».

---

## 3. Чат

Основной поток (ChatPage):

- ввод сообщения → ACP `session/prompt` → поток `session/update` (текст, thinking, tool_call) → лента;
- **ctx-метр** в топбаре: использованные токены / окно модели (из `usage_update`) + кнопка **«Сжать»** (`/compact`);
- кнопка **↓** — плавающая scroll-to-bottom: прыжок к последнему сообщению, если вы проскроллили вверх;
- **Новый чат** — чистый `session/new`; переключение между чатами — через сайдбар/Историю (`session/load` с replay истории);
- отладочные и служебные slash-команды goose (`/status`, `/model`, `/mode`, `/compact`, …) работают при ручном вводе в поле.

Состояния соединения — явная state machine: `idle → connecting → ready → streaming → closed` (+ `error`); недопустимые переходы игнорируются и пишутся в лог.

### Режимы работы (goose 1.52)

Settings → вкладка «Пользовательский интерфейс» → **Режим goose**:

| Режим в UI | Значение `GOOSE_MODE` | Поведение |
|---|---|---|
| **Автономный** | `auto` | Полное выполнение: файлы, запуски, расширения без подтверждений |
| **Вручную** | `approve` | Все действия требуют подтверждения человеком |
| **Утверждать** | `smart_approve` | Минимум подтверждений, исходя из уровня риска |
| **Чат** | `chat` | Только разговор/планы: инструменты не вызываются |

Как применяется режим:
- изменение пишется в `config.yaml` (`GOOSE_MODE`) — действует на **новые** сессии;
- для **живой** сессии UI дополнительно шлёт ACP `session/set_mode` (режим применяется сразу, индикатор обновляется по `current_mode_update`).

**Разрешения (permissions).** Запросы `session/request_permission` логируются (`acp.permission.request`) и по умолчанию **запрещаются**: авто-разрешение — только в явном режиме `auto`; в остальных случаях без явного выбора пользователя — deny (fail-safe). Диалог выбора разрешения в UI дорабатывается (см. [goose-152-compat.md](goose-152-compat.md), «Критичные пробелы»).

---

## 4. Субагенты: Оракул, Библиотекарь, Метис

Маяк — **не отдельный чат субагентов**, а слой над goose orchestrator. Основной агент (кондуктор, `pantheon-conductor.md`) решает, кого делегировать:

| Когда | Кого | Как |
|---|---|---|
| Незнакомая библиотека/доки/API | **Библиотекарь** (дёшево, параллельно) | `delegate(source: librarian)` |
| Сложный план / архитектура / 2+ неудачных фикса | **Оракул** (дорого, глубоко) | `delegate(source: oracle)` — после выжимок Библиотекаря |
| Ревью плана перед реализацией (HIGH/CRIT) | **Метис** (адверсариальный критик) | `delegate(source: metis)` — после плана Оракула |

Правила кондуктора (зашиты в `agents/pantheon-conductor.md`):
- **LOW** → делай сам, без делегирования;
- **MED** → своё усмотрение, Библиотекарь допустим;
- **HIGH** → план через Оракула (при необходимости сначала Библиотекарь);
- **CRIT** → полная цепочка: Библиотекарь (если нужен контекст) → Оракул → **Метис** → потом реализация; на CRIT Метис не пропускается;
- CRIT/HIGH находки Метиса → обратно Оракулу на ревизию плана (не больше 2 кругов).

### Авто-эскалация `[ESCALATION:LEVEL]`

Хук `UserPromptSubmit` (`plugin/scripts/escalate.sh`) классифицирует **каждый** пользовательский промпт по ключевым словам (RU+EN) и длине:
- score 0 → `LOW`, 1–3 → `MED`, 4–7 → `HIGH`, ≥8 → `CRIT`;
- в промпт вешается тег `[ESCALATION:LOW|MED|HIGH|CRIT]`;
- кондуктор обязан трактовать тег как вердикт сложности (его суждение может поднять уровень, но не опустить);
- хук не падает никогда: любая ошибка = «нет тега» (exit 0).

### Как это видно в UI

- в ленте чата delegate-вызовы отображаются как tool-call (источник + инструкции);
- справа **rail**: список субагентов текущей сессии (event-driven: tool_call с `_meta.subagent_session_id` + reconcilation каждые 15 с);
- клик по субагенту → **SubagentStream**: его ходы (задача / ход / ответ, thinking, tool-chips), опрос `sessions.db` каждые 2 с;
- Esc/✕ — закрыть стрим, вернуться к основному чату.

Артефакты личностей — в `.pantheon/` (пути относительно рабочей директории сессии):
`plans/`, `analysis/` (Оракул/Метис), `digests/` (Библиотекарь).

---

## 5. Вложения

Способы прикрепить файл в чат:
- **Ctrl+V** — картинка из буфера (через `wl-paste`);
- **drag & drop** на окно (GPUIX `onFileDrop`, абсолютные пути ОС);
- **скрепка** — file picker.

Что происходит дальше:
- картинки сжимаются до ≤1024 px (JPEG q85, ImageMagick; без magick — оригинал) и уходят **image-блоками** ACP;
- документы стейджатся в `~/.cache/goose/mayak-attachments/` (лимит 25 МБ), путь вставляется в текст промпта;
- чипы-превью над полем ввода (лимит 8 вложений).

Субагенты получают картинки через реестр `sessionImagePaths`: путь попадает в текст delegate-промпта, субагент читает его `read_image` (первым действием). Путь из промпта — единственный источник истины: выдумывать `/tmp`-пути запрещено.

---

## 6. Панель Маяка (расходы, аудит, состояние)

**Настройки → вкладка «Состояние»** (или пункт панели) → «Панель Маяка»:

| Секция | Что показывает |
|---|---|
| **RUNS** | запущённые/завершённые сессии-раны: роль, статус, модель, время, sid |
| **РОЛИ** | агрегат по ролям (oracle/librarian/metis/goose): сессии, статусы |
| **РАСХОДЫ · 7 ДНЕЙ** | per-role расходы: input/output токены и **USD** за 7 дней (источник — `usage_ledger`, записи из ACP `usage_update`, стоимость считается по прайс-листу моделей, если не пришла из API) |
| **АРТЕФАКТЫ** | `.pantheon/*` файлы (plan/digest/analysis) с темой и сессией |
| **ИСТОРИЯ ПРАВОК** | аудит изменений конфигов: актор, что менялось, hash старого/нового значения, превью, время |

Данные: `pantheon.db` (`runs`, `usage_ledger`, `events`, `artifacts`, `kv`).
Записи аудита создаются централизованно через `auditConfigChange(...)` — любое изменение конфига через UI проходит через неё.

Дополнительно в UI:
- **UsageBar** — лимиты подписки OpenCode Go (окна 5 ч / неделя / месяц, опрос `/v1/usage` каждые 30 с);
- **История сессий** — список чатов из `sessions.db`, открытие кликом;
- **ctx-метр** — токены текущей сессии относительно окна модели.

---

## 7. Настройки моделей

### Цепочки моделей (primary + fallbacks)

Settings → вкладка **«Модели»** → ChainEditor: для каждой роли (goose, oracle, librarian, metis) задаётся primary-модель и список fallback'ов.

⚠️ **Правило синхронизации:** смена модели ОБЯЗАНА отразиться сразу в трёх местах:

1. `~/.config/goose/pantheon.toml` — цепочки (источник для UI);
2. frontmatter `~/.agents/agents/<role>.md` → `model:`;
3. `~/.config/goose/recipes/<role>-*.yaml` → `settings.goose_model`.

Автосинк выполняется автоматически в `saveAgentChain` (`ui/mayak-ui/src/api/config.ts`) — **не правьте файлы вразнос** вручную. Приоритет модели при delegate: recipe/frontmatter **побеждают** override `model:` в delegate (`pantheon.toml` — документация/UI, его одного недостаточно).

Текущие цепочки (OpenCode Go, `pantheon.toml`): см. таблицу в [README.md](README.md).

### Активная модель (общая)

Settings → «Модели» → активная модель/провайдер → пишется в `config.yaml` **с бэкапом**. Действует для новых сессий (для смены «на лету» у goose есть `/model` и `session/set_mode` — интеграция в плане, см. compat).

### Валидация

«Проверить» в ChainEditor → `validateChainStep` (мини-запрос к API, маппинг ошибок 403/400) — не даёт сохранить нерабочий шаг цепочки.

### Редактор промптов

Settings → **«Программы»** — редактирование `~/.config/goose/prompts/*.md` (whitelist из 7 файлов: `system.md`, `subagent_system.md`, `compaction.md`, `permission_judge.md`, …) с бэкапом `.bak`.

### Лимиты

Settings → **«Приложение»**: `GOOSE_MAX_TURNS`, `GOOSE_AUTO_COMPACT_THRESHOLD` — чтение и показ (правка из UI в плане, P1).

---

## 8. Расширения, история, прочее

- **Расширения** — toggle `extensions.*.enabled` в `config.yaml` (с бэкапом `.yaml.bak-mayak`), включая `orchestrator`, `pantheon-state`, `skills`;
- **История сессий** — открытие старого чата с replay (`session/load`); субагенты в истории — drill-down стрим;
- **Рецепты** — список `~/.config/goose/recipes/` (паритет `goose recipe list`);
- **Планировщик** — jobs из `~/.local/share/goose/schedule.json` (просмотр; добавление/пауза — roadmap P1, goose запущен с `--enable-scheduler`);
- **Приложения** — список stored apps + открытие; создание — инструментами apps в чате.

---

## 9. Диагностика

| Что | Где |
|---|---|
| Логи UI | `~/.local/state/mayak-ui/mayak.log` (ротация 5 МБ × 3; уровень — env `MAYAK_LOG=debug\|info\|warn\|error`) |
| Логи sidecar | `~/.local/state/mayak-ui/goose-serve.log` |
| Логи плагина (guard/hooks/MCP) | `~/.local/state/pantheon/guard.log` |
| LLM-запросы goose | `~/.local/state/goose/logs/llm_request.*.jsonl` (ротация keep=10) |
| Формат лога | `timestamp \| level \| module \| sid \| event \| detail` |

Критерий наблюдаемости: по логу должна находиться точка отказа любой транзакции. Пример:

```
2026-09-29T21:40:12.345Z | ERROR | acp.ts | 20260929_3 | session/load | sessionId=undefined fallback=loadId
```

---

## 10. Частые вопросы

**Q: «[object Event]» при подключении / зомби goose serve?**
Это был Origin 403 (Tauri/`tauri://localhost`); в текущей версии UI передаёт exact-list `--allowed-origin` + секрет, переиспользует живой sidecar. Проверьте `goose-serve.log`.

**Q: Модель в субагенте не та, что ожидала?**
Приоритет: recipe/frontmatter → delegate override. Проверьте все три места синхронизации (§7) — `pantheon.toml` одного недостаточно.

**Q: Субагент не видит картинку?**
У модели нет `image` в modalities (например `glm-5.3` — text-only) → goose шлёт «image was omitted». Переключите цепочку на vision-модель (mimo-v2.6-pro/flash, glm-5.3-flash, kimi-k3, gpt-5.6-luna, deepseek-v4.1-flash).

**Q: Кто-то пишет вне `.pantheon/`?**
Это блокирует guard-rs (`on_failure: block`), запись — в `guard.log` с ролью и причиной. Слабить guard нельзя (см. AGENTS.md §7).

**Q: `goose update` откатил версию?**
Да, официальный релиз может быть старее ручной сборки 1.52 — не запускайте `goose update`, пока официальная версия не догнала.
