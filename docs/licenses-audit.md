# Аудит лицензий зависимостей — «Маяк» (ex-Пантеон)

> **Дата:** 2026-10-01 · **Коммит:** `23e80d05` · **Режим:** read-only анализ (код не менялся)
> **Источники:** `ui/mayak-ui/package.json` + `node_modules/**/package.json` и LICENSE-файлы, `plugin/guard-rs/Cargo.toml` + `Cargo.lock` + `~/.cargo/registry/src/**/Cargo.toml` (license-поле), системные пакеты (`pacman -Qi`), бинарь `~/.local/bin/goose` (strings).
> Все лицензии ниже — **фактические**, прочитанные из файлов, а не заявленные «по памяти».

---

## 1. Прямые зависимости (ui/mayak-ui)

| Пакет | Версия | Тип лицензии | Источник (файл/URL) | Комментарий/ограничения |
|---|---|---|---|---|
| `@aaif/goose-acp-client` | 1.52.0 | **Apache-2.0** | `node_modules/@aaif/goose-acp-client/package.json` → `"license": "Apache-2.0"` | Наш пакет (AAIF). ⚠️ В пакете **нет LICENSE-файла** — только поле в package.json; при публикации npm-пакета добавить текст Apache-2.0 + NOTICE |
| `@gpuix/react` | 0.10.0 | **Apache-2.0** | `node_modules/@gpuix/react/LICENSE` (текст «Apache License Version 2.0») + package.json | GUI-фреймворк (React-слой GPUIX). Полная проверка текста лицензии OK |
| `@gpuix/native` | 0.10.0 | **Apache-2.0** | `node_modules/@gpuix/native/LICENSE` + package.json | Нативный слой GPUIX |
| `@gpuix/native-linux-x64-gnu` | 0.10.0 | **Apache-2.0** | `node_modules/@gpuix/native-linux-x64-gnu/package.json` | Prebuilt napi-бинарь для linux-x64. Редистрибуция бинаря допустима при сохранении Apache-2.0/NOTICE |
| `react` | 19.3.0 | **MIT** | `node_modules/react/LICENSE` | OK |
| `smol-toml` | 1.9.0 | **BSD-3-Clause** | package.json + `LICENSE` | Пермиссивная |
| `yaml` | 2.9.1 | **ISC** | package.json + `LICENSE` | Пермиссивная |
| `@types/bun` (dev) | 1.4.2 | **MIT** | package.json | только dev |
| `@types/react` (dev) | 19.3.0 | **MIT** | package.json | только dev |
| `typescript` (peer) | 7.0.2 | **Apache-2.0** | `node_modules/typescript/LICENSE` | только dev/peer, в бандл не попадает |

---

## 2. Транзитивные JS-зависимости (node_modules, всего 111 пакетов)

Источник для всех строк: `node_modules/<pkg>/package.json` (поле `license`), при наличии — сверено с файлом `LICENSE`/`license.md`. Ниже полный список (прямые зависимости из §1 помечены **[direct]**).

| Пакет | Версия | Тип лицензии | Источник | Комментарий |
|---|---|---|---|---|
| `@aaif/goose-acp-client` | 1.52.0 | Apache-2.0 | package.json | **[direct]** |
| `@agentclientprotocol/sdk` | 1.5.0 | Apache-2.0 | package.json + LICENSE | ACP SDK (зависимость goose-acp-client) |
| `@gpuix/native` | 0.10.0 | Apache-2.0 | package.json + LICENSE | **[direct]** |
| `@gpuix/native-linux-x64-gnu` | 0.10.0 | Apache-2.0 | package.json | prebuilt бинарь |
| `@gpuix/react` | 0.10.0 | Apache-2.0 | package.json + LICENSE | **[direct]** |
| `@hono/node-server` | 2.1.1 | MIT | package.json + LICENSE | |
| `@modelcontextprotocol/ext-apps` | 1.7.5 | MIT | package.json + LICENSE | |
| `@modelcontextprotocol/sdk` | 1.30.1 | MIT | package.json + LICENSE | |
| `@standard-schema/spec` | 1.1.0 | MIT | package.json | |
| `@types/bun` | 1.4.2 | MIT | package.json | **[direct dev]** |
| `@types/node` | 26.6.2 | MIT | package.json | |
| `@types/react` | 19.3.0 | MIT | package.json | **[direct dev]** |
| `@typescript/typescript-linux-x64` | 7.0.2 | Apache-2.0 | package.json | нативный бинарь tsc (peer) |
| `accepts` | 2.0.0 | MIT | package.json + LICENSE | |
| `ajv` | 8.20.0 | MIT | package.json + LICENSE | |
| `ajv-formats` | 3.0.1 | MIT | package.json + LICENSE | |
| `body-parser` | 2.3.0 | MIT | package.json + LICENSE | |
| `bun-types` | 1.4.2 | MIT | package.json | |
| `bytes` | 3.1.2 | MIT | package.json + LICENSE | |
| `call-bind-apply-helpers` | 1.0.2 | MIT | package.json + LICENSE | |
| `call-bound` | 1.0.4 | MIT | package.json + LICENSE | |
| `content-disposition` | 1.1.0 | MIT | package.json + LICENSE | |
| `content-type` | 1.0.5 | MIT | package.json + LICENSE | |
| `cookie` | 0.7.2 | MIT | package.json + LICENSE | |
| `cookie-signature` | 1.2.2 | MIT | package.json + LICENSE | |
| `cors` | 2.8.6 | MIT | package.json + LICENSE | |
| `cross-spawn` | 7.0.6 | MIT | package.json + LICENSE | |
| `csstype` | 3.2.3 | MIT | package.json + LICENSE | |
| `debug` | 4.4.3 | MIT | package.json + LICENSE | |
| `depd` | 2.0.0 | MIT | package.json + LICENSE | |
| `dunder-proto` | 1.0.1 | MIT | package.json + LICENSE | |
| `ee-first` | 1.1.1 | MIT | package.json + LICENSE | |
| `encodeurl` | 2.0.0 | MIT | package.json + LICENSE | |
| `escape-html` | 1.0.3 | MIT | package.json + LICENSE | |
| `es-define-property` | 1.0.1 | MIT | package.json + LICENSE | |
| `es-errors` | 1.3.0 | MIT | package.json + LICENSE | |
| `es-object-atoms` | 1.1.2 | MIT | package.json + LICENSE | |
| `etag` | 1.8.1 | MIT | package.json + LICENSE | |
| `eventsource` | 3.0.7 | MIT | package.json + LICENSE | |
| `eventsource-parser` | 4.1.1 | MIT | package.json + LICENSE | |
| `express` | 5.2.1 | MIT | package.json + LICENSE | |
| `express-rate-limit` | 8.7.0 | MIT | package.json + license | |
| `fast-deep-equal` | 3.1.3 | MIT | package.json + LICENSE | |
| `fast-uri` | 3.1.8 | **BSD-3-Clause** | package.json | |
| `finalhandler` | 2.1.1 | MIT | package.json + LICENSE | |
| `forwarded` | 0.2.0 | MIT | package.json + LICENSE | |
| `fresh` | 2.0.0 | MIT | package.json + LICENSE | |
| `function-bind` | 1.1.2 | MIT | package.json + LICENSE | |
| `get-intrinsic` | 1.3.0 | MIT | package.json + LICENSE | |
| `get-proto` | 1.0.1 | MIT | package.json + LICENSE | |
| `gopd` | 1.2.0 | MIT | package.json + LICENSE | |
| `has-symbols` | 1.1.0 | MIT | package.json + LICENSE | |
| `hasown` | 2.0.4 | MIT | package.json + LICENSE | |
| `hono` | 4.13.9 | MIT | package.json + LICENSE | |
| `http-errors` | 2.0.1 | MIT | package.json + LICENSE | |
| `iconv-lite` | 0.7.3 | MIT | package.json + LICENSE | |
| `inherits` | 2.0.4 | **ISC** | package.json + LICENSE | |
| `ip-address` | 10.7.2 | MIT | package.json + LICENSE | |
| `ipaddr.js` | 1.9.1 | MIT | package.json + LICENSE | |
| `is-promise` | 4.0.0 | MIT | package.json + LICENSE | |
| `isexe` | 2.0.0 | **ISC** | package.json + LICENSE | |
| `jose` | 6.2.12 | MIT | package.json + LICENSE.md | |
| `json-schema-traverse` | 1.0.0 | MIT | package.json + LICENSE | |
| `json-schema-typed` | 8.0.2 | **BSD-2-Clause** | package.json + LICENSE.md | |
| `math-intrinsics` | 1.1.0 | MIT | package.json + LICENSE | |
| `media-typer` | 1.1.1 | MIT | package.json + LICENSE | |
| `merge-descriptors` | 2.0.0 | MIT | package.json + license | |
| `mime-db` | 1.54.0 | MIT | package.json + LICENSE | |
| `mime-types` | 3.0.2 | MIT | package.json + LICENSE | |
| `ms` | 2.1.3 | MIT | package.json + license.md | |
| `negotiator` | 1.1.0 | MIT | package.json + LICENSE | |
| `object-assign` | 4.1.1 | MIT | package.json + license | |
| `object-inspect` | 1.13.4 | MIT | package.json + LICENSE | |
| `on-finished` | 2.4.1 | MIT | package.json + LICENSE | |
| `once` | 1.4.0 | **ISC** | package.json + LICENSE | |
| `parseurl` | 1.3.3 | MIT | package.json + LICENSE | |
| `path-key` | 3.1.1 | MIT | package.json + license | |
| `path-to-regexp` | 8.4.2 | MIT | package.json + LICENSE | |
| `pkce-challenge` | 5.0.1 | MIT | package.json + LICENSE | |
| `proxy-addr` | 2.0.8 | MIT | package.json + LICENSE | |
| `qs` | 6.16.0 | **BSD-3-Clause** | package.json + LICENSE.md | |
| `range-parser` | 1.3.0 | MIT | package.json + LICENSE | |
| `raw-body` | 3.0.2 | MIT | package.json + LICENSE | |
| `react` | 19.3.0 | MIT | package.json + LICENSE | **[direct]** |
| `react-reconciler` | 0.31.0 | MIT | package.json + LICENSE | |
| `require-from-string` | 2.0.2 | MIT | package.json + license | |
| `router` | 2.2.0 | MIT | package.json + LICENSE | |
| `safer-buffer` | 2.1.2 | MIT | package.json + LICENSE | |
| `scheduler` | 0.25.0 | MIT | package.json + LICENSE | |
| `send` | 1.2.1 | MIT | package.json + LICENSE | |
| `serve-static` | 2.2.1 | MIT | package.json + LICENSE | |
| `setprototypeof` | 1.2.0 | **ISC** | package.json + LICENSE | |
| `shebang-command` | 2.0.0 | MIT | package.json + license | |
| `shebang-regex` | 3.0.0 | MIT | package.json + license | |
| `side-channel` | 1.1.1 | MIT | package.json + LICENSE | |
| `side-channel-list` | 1.0.1 | MIT | package.json + LICENSE | |
| `side-channel-map` | 1.0.1 | MIT | package.json + LICENSE | |
| `side-channel-weakmap` | 1.0.2 | MIT | package.json + LICENSE | |
| `smol-toml` | 1.9.0 | **BSD-3-Clause** | package.json + LICENSE | **[direct]** |
| `statuses` | 2.0.2 | MIT | package.json + LICENSE | |
| `toidentifier` | 1.0.1 | MIT | package.json + LICENSE | |
| `type-is` | 2.1.0 | MIT | package.json + LICENSE | |
| `typescript` | 7.0.2 | Apache-2.0 | package.json + LICENSE | **[peer/dev]** |
| `undici-types` | 8.9.0 | MIT | package.json | |
| `unpipe` | 1.0.0 | MIT | package.json + LICENSE | |
| `vary` | 1.1.2 | MIT | package.json + LICENSE | |
| `which` | 2.0.2 | **ISC** | package.json + LICENSE | |
| `wrappy` | 1.0.2 | **ISC** | package.json + LICENSE | |
| `yaml` | 2.9.1 | **ISC** | package.json + LICENSE | **[direct]** |
| `zod` | 4.6.5 | MIT | package.json | суб-манифесты (`zod/v4` и т.п.) без поля license — наследуют лицензию корневого `zod` |
| `zod-to-json-schema` | 3.25.2 | **ISC** | package.json | |

> Скан на copyleft (`GPL|LGPL|AGPL|MPL|CDDL|SSPL|BUSL|Proprietary` в полях license и в текстах LICENSE-файлов): **совпадений 0**.

---

## 3. Rust-зависимости (plugin/guard-rs, `Cargo.lock` = 32 крейта)

Источник: поле `license` в `~/.cargo/registry/src/index.crates.io-*/<crate>-<ver>/Cargo.toml` (распакованный исходник крейта).

| Пакет | Версия | Тип лицензии | Источник | Комментарий/ограничения |
|---|---|---|---|---|
| `pantheon-guard` (наш крейт) | 0.1.0 | **не указана** ⚠️ | `plugin/guard-rs/Cargo.toml` | Нет поля `license` — **добавить** (`license = "MIT"` или `Apache-2.0`) перед публикацией |
| `rusqlite` | 0.32.1 | **MIT** | registry `Cargo.toml` + `LICENSE` | прямая |
| `serde_json` | 1.0.151 | **MIT OR Apache-2.0** | registry `Cargo.toml` (LICENSE-MIT + LICENSE-APACHE) | прямая |
| `serde` | 1.0.229 | MIT OR Apache-2.0 | registry | |
| `serde_core` | 1.0.228 | MIT OR Apache-2.0 | registry | |
| `serde_derive` | 1.0.229 | MIT OR Apache-2.0 | registry | |
| `libsqlite3-sys` | 0.30.1 | **MIT** (обёртка) + **public domain** (SQLite) | registry `LICENSE`; `sqlite3/sqlite3.c`: «The author disclaims copyright to this source code» | фича `bundled` → амальгама SQLite **компилируется в наш бинарь**; SQLite — public domain, obligations нет |
| `syn` | 2.0.119 | MIT OR Apache-2.0 | registry | |
| `syn` | 3.0.6 | MIT OR Apache-2.0 | registry | |
| `proc-macro2` | 1.0.107 | MIT OR Apache-2.0 | registry | |
| `quote` | 1.0.47 | MIT OR Apache-2.0 | registry | |
| `unicode-ident` | 1.0.26 | (MIT OR Apache-2.0) **AND Unicode-3.0** | registry | Unicode-3.0 — пермиссивная, без copyleft; ограничения только на названия/бренды Unicode |
| `ahash` | 0.8.12 | MIT OR Apache-2.0 | registry | |
| `bitflags` | 2.13.2 | MIT OR Apache-2.0 | registry | |
| `cc` | 1.5.1 | MIT OR Apache-2.0 | registry | |
| `cfg-if` | 1.0.5 | MIT OR Apache-2.0 | registry | |
| `fallible-iterator` | 0.3.0 | MIT/Apache-2.0 | registry | |
| `fallible-streaming-iterator` | 0.1.9 | MIT/Apache-2.0 | registry | |
| `find-msvc-tools` | 0.1.14 | MIT OR Apache-2.0 | registry | |
| `hashbrown` | 0.14.5 | MIT OR Apache-2.0 | registry | |
| `hashlink` | 0.9.1 | MIT OR Apache-2.0 | registry | |
| `itoa` | 1.0.18 | MIT OR Apache-2.0 | registry | |
| `memchr` | 2.8.3 | **Unlicense OR MIT** | registry | public-domain-подобная + MIT — пермиссивно |
| `once_cell` | 1.21.4 | MIT OR Apache-2.0 | registry | |
| `pkg-config` | 0.3.34 | MIT OR Apache-2.0 | registry | |
| `shlex` | 2.0.1 | MIT OR Apache-2.0 | registry | |
| `smallvec` | 1.16.2 | MIT OR Apache-2.0 | registry | |
| `vcpkg` | 0.2.15 | MIT/Apache-2.0 | registry | |
| `version_check` | 0.9.5 | MIT/Apache-2.0 | registry | |
| `zerocopy` | 0.8.59 | **BSD-2-Clause OR Apache-2.0 OR MIT** | registry | |
| `zerocopy-derive` | 0.8.59 | BSD-2-Clause OR Apache-2.0 OR MIT | registry | |
| `zmij` | 1.0.23 | **MIT** | registry | |

> Copyleft-крейтов в дереве `guard-rs`: **0**.

---

## 4. Системные и внешние компоненты

| Компонент | Версия | Тип лицензии | Источник | Комментарий/ограничения |
|---|---|---|---|---|
| **goose** (sidecar) | 1.52.0 | **Apache-2.0** | `~/.local/bin/goose` (ELF): 81 вхождение «Apache License, Version 2.0»; апстрим `github.com/block/goose` — Apache-2.0 | Запускается **отдельным процессом** (sidecar), не линкуется и не встраивается в наш код → лицензия goose **не накладывается** на наш код. Обязательство возникает только если мы **редистрибуем бинарь goose** (тогда: сохранить текст Apache-2.0 + NOTICE) |
| **bun** (рантайм выполнения mayak-ui) | 1.4.2 (`bun-bin`) | **MIT** | `pacman -Qi bun` → `Licenses: MIT` | Рантайм, не встраивается в наш код. ⚠️ В бинарь Bun входит JavaScriptCore (WebKit, LGPL-2.1/BSD) — релевантно только при **редистрибуции самого bun**; мы bun не редистрибуем. Проверить при упаковке, если bundler'им bun |
| **SQLite** (bundled в guard-rs) | амальгама в `libsqlite3-sys` | **public domain** | `sqlite3/sqlite3.c` header: «author disclaims copyright» | Компилируется в наш бинарь — obligation отсутствует |
| `webkit2gtk-4.1`, `gtk3`, `sqlite` (runtime legacy) | системные | **LGPL-2.1** (GTK/WebKit) | системные пакеты Arch | Только для legacy Tauri; динамическая линковка системных библиотек → наши обязательства ограничены тем, что мы их **не модифицируем и не встраиваем** |
| `packaging/appimage-runtime` | — | **неизвестно, требует проверки** | `packaging/appimage-runtime` (бинарь) | Происхождение/лицензия локально не подтверждены. **Не редистрибутировать** до проверки |
| `packaging/pantheon-ui-bin-*.pkg.tar.zst`, `pantheon-ui-bin.AppImage`, `packaging/pantheon-ui` | 0.1.0 | собраны из legacy-стека (см. §5) | локальные артефакты | Локальные сборки, в git-репозиторий (предположительно) не входят; перед публикацией релизов — проверить состав |

---

## 5. Legacy: ui/pantheon-ui-tauri-legacy 🗄 ARCHIVE

Статус: **архив** (LEGACY.md: активный стек — `ui/mayak-ui`). `node_modules` отсутствует → JS-пакеты локально не проверялись.

**Rust-зависимости (прямые, проверены по registry-исходникам):**

| Пакет | Версия | Тип лицензии | Источник | Комментарий |
|---|---|---|---|---|
| `tauri` | 2.11.5 | **Apache-2.0 OR MIT** | registry `Cargo.toml` | |
| `tauri-build` | 2.6.3 | Apache-2.0 OR MIT | registry | |
| `tokio` | 1.49.0 | **MIT** | registry | |
| `ureq` | 2.12.1 | MIT OR Apache-2.0 | registry | |
| `dirs` | 5.0.1 | MIT OR Apache-2.0 | registry | |
| `serde_yaml` | 0.9.34 | MIT OR Apache-2.0 | registry | помечен upstream как `+deprecated` |
| `toml` | 0.9.11 | MIT OR Apache-2.0 | registry | |
| `serde` / `serde_json` / `rusqlite` | — | MIT OR Apache-2.0 / MIT | registry | те же, что в §3 |

**JS-зависимости (из `package.json`, локально НЕ проверены — `node_modules` отсутствует):**
`@tauri-apps/api@^2`, `@tauri-apps/cli@^2` (dev), `react@^18.3.1`, `react-dom@^18.3.1`, `vite@^5.4.0` (dev), `@vitejs/plugin-react`, `@agentclientprotocol/sdk`, `@aaif/goose-acp-client`, `typescript@^5.5.3` → **«требует проверки локально»**; по апстрим-политике эти пакеты пермиссивны (MIT / Apache-2.0), но для отчёта это **не подтверждено файлами**.

**Полное дерево legacy Rust** (включая транзитивные крейты Tauri, ~300+) **не аудировалось** — архив не собирается и не поддерживается.

---

## 6. Агрегация

### JS/TS (`ui/mayak-ui/node_modules`, 111 пакетов)

| Тип лицензии | Кол-во | Доля |
|---|---:|---:|
| MIT | 92 | 82.9% |
| ISC | 8 | 7.2% |
| Apache-2.0 | 7 | 6.3% |
| BSD-3-Clause | 3 | 2.7% |
| BSD-2-Clause | 1 | 0.9% |
| **Copyleft (GPL/LGPL/AGPL/MPL/…)** | **0** | 0% |
| Proprietary / неизвестно | **0** | 0% |
| **Итого** | **111** | 100% |

### Rust (`plugin/guard-rs`, 32 крейта в Cargo.lock)

| Тип лицензии | Кол-во |
|---|---:|
| Двойная MIT OR Apache-2.0 (и вариации `MIT/Apache-2.0`) | 24 |
| Только MIT (`rusqlite`, `libsqlite3-sys`, `zmij`) | 3 |
| BSD-2-Clause OR Apache-2.0 OR MIT (`zerocopy*`) | 2 |
| Unlicense OR MIT (`memchr`) | 1 |
| (MIT OR Apache-2.0) AND Unicode-3.0 (`unicode-ident`) | 1 |
| Public domain (SQLite, bundled) | 1 (в составе `libsqlite3-sys`) |
| Наш `pantheon-guard` — лицензия **не указана** ⚠️ | 1 |
| **Copyleft / proprietary** | **0** |

### Внешние/системные
- goose 1.52.0 — Apache-2.0 (sidecar, отдельный процесс)
- bun 1.4.2 — MIT (рантайм; JSC внутри бинаря — LGPL-2.1 при редистрибуции bun)
- SQLite (bundled) — public domain
- WebKitGTK/GTK3 (legacy runtime) — LGPL-2.1, системные, динамическая линковка
- `appimage-runtime` — **неизвестно, требует проверки**
- Legacy JS-пакеты — **не проверены локально, требует проверки**

### Итог: **весь код зависимостей, входящих в наш продукт, — пермиссивный (MIT/ISC/BSD/Apache-2.0). Copyleft-зависимостей НЕТ.**

---

## 7. Совместимость (copyleft-анализ)

**Копилефт-зависимостей (GPL/AGPL/LGPL/MPL-в-коде) в проекте нет.** Это значит:

1. **Нет obligation открыть наш исходный код.** Любой лицензионный режим — MIT, Apache-2.0, MPL, даже проприетарный — был бы совместим с зависимостями.
2. **Apache-2.0 (7 JS-пакетов + крейты с двойной MIT/Apache-2.0)** — пермиссивная, но с *notice*-обязательством:
   - при распространении **производного/составного** кода нужно сохранять текст Apache-2.0 и упоминания NOTICE;
   - содержит патентную клаузулу (patent clause — автоматический патентный грант от авторов зависимостей).
   - Совместима с MIT: MIT-код можно включать в Apache-2.0-проект; наоборот — наш MIT-код может *использовать* Apache-2.0-библиотеки (они остаются Apache-2.0, их notices сохраняются).
3. **Потенциальный LGPL — только во внешних рантаймах**, не в нашем коде:
   - GTK/WebKitGTK — системные зависимости legacy Tauri (динамическая линковка, ничего не модифицируем) — допустимо;
   - JavaScriptCore внутри бинаря bun — релевантно лишь если редистрибуировать сам bun;
   - goose (Apache-2.0) — отдельный процесс/sidecar, obligation только при редистрибуции бинаря goose.
4. **Контрафактуальный сценарий**: если в будущем появится GPL/AGPL-зависимость (например, в GUI-слое), потребуется либо сменить нашу лицензию на GPL-совместимую, либо отказаться от зависимости. Сейчас барьер нулевой.

---

## 8. Рекомендация по лицензии нашего проекта

**Критерии:** open-source (предпочтение автора), пермиссивное окружение зависимостей, sidecar-модель goose, GUI на GPUIX, уже существующая декларация в `packaging/PKGBUILD` (`license=('MIT')`).

### Вариант A (рекомендуемый): **MIT**
- **Совпадает** с уже заявленной лицензией в `packaging/PKGBUILD` (legacy-пакет) — не придётся менять упаковку.
- Максимальная совместимость: все 111 JS-зависимостей и все 32 Rust-крейта пермиссивны; MIT можно комбинировать с MIT/ISC/BSD/Apache-2.0 без ограничений.
- Копилефт-зависимостей нет → ничего не обязывает выбирать GPL/MPL.
- Классический выбор для инструментов-оверлеев (сам goose у нас Apache-2.0, но он sidecar — конфликта нет).

### Вариант B: **Apache-2.0**
- Даёт **патентную защиту** (патентная клаузула) от контрибьюторов — плюс для проекта, куда будут писать внешние контрибьюторы.
- Совместим с зависимостями, но добавляет burden: при редистрибуции сборных бинарных релизов нужно сохранять NOTICE и текст Apache-2.0 (касается наших Apache-2.0-зависимостей: `@gpuix/*`, `@aaif/goose-acp-client`, ACP SDK, TypeScript).
- Минус: несовместим с чисто-MIT-потребителями *нашего* кода? Нет — Apache-2.0-код можно использовать в MIT-проектах только с сохранением его условий; фактически это чуть менее «тривиально» для потребителей.

### Вариант C (компромисс): **двойная `MIT OR Apache-2.0`**
- Максимум свободы для потребителя (выбирает сам), как у serde/tokio/tauri.
- Рекомендуемый «правильный» вариант для Rust-проектов с экосистемой crates.io.

### Вариант D: **MPL-2.0 / GPL / LGPL — НЕ рекомендуется**
- MPL даёт file-level copyleft без нужды (копилефт-зависимостей нет) → лишнее трение для потребителей.
- GPL/AGPL/LGPL ограничат распространение (не хотим: goose-оверлей призван быть свободно встраиваемым).

**Итоговая рекомендация:**
1. **Примит `MIT` для всего репозитория** (быстро, совместимо с PKGBUILD, снимает вопрос «а какая лицензия у нас» для open-source публикации) **или `MIT OR Apache-2.0`**, если ожидаем контрибьюторов и корпоративное использование.
2. Обязательно: **добавить файл `LICENSE` в корень репозитория** — его сейчас **нет** (проверено: `~/pantheon/LICENSE*` отсутствует).
3. Добавить `license = "MIT"` (или Apache-2.0) в `plugin/guard-rs/Cargo.toml` → `package.license`.
4. Рядом с LICENSE желателен `THIRD-PARTY-NOTICES.md` (список Apache-2.0-зависимостей: `@gpuix/*`, `@aaif/goose-acp-client`, `@agentclientprotocol/sdk`, `typescript`), чтобы закрыть notice-обязательство Apache-2.0.

---

## 9. Риски и ограничения

| # | Риск | Серьёзность | Что делать |
|---|---|---|---|
| 1 | **Нет `LICENSE` в корне репозитория** | 🔴 высокая для публикации | Добавить до первого open-source релиза (см. §8) |
| 2 | **`plugin/guard-rs`: нет поля `license`** в Cargo.toml | 🟡 средняя | Проставить `license = "MIT"` / `Apache-2.0` |
| 3 | **`@aaif/goose-acp-client` не содержит LICENSE-файла** (только поле в package.json) | 🟡 средняя | Положить текст Apache-2.0 в npm-пакет |
| 4 | **`packaging/appimage-runtime` — лицензия неизвестна, требует проверки** | 🟡 средняя | Не редистрибутировать до выяснения (проверить источник AppImage runtime) |
| 5 | **Legacy JS-пакеты не проверены** (`node_modules` отсутствует) | 🟢 низкая (архив) | Не поддерживать/не собирать; при необходимости — `pnpm install` и повторный скан |
| 6 | **Бинарные артефакты в `packaging/`** (AppImage, pkg.tar.zst) содержат legacy-сборку с динамической линковкой GTK/WebKit | 🟢 низкая | При публикации релизов — фиксировать состав и системные зависимости (уже в PKGBUILD: `webkit2gtk-4.1`, `gtk3`, `sqlite`) |
| 7 | **OpenCode Go — коммерческий сервис** (подписка rev 2, ключи API) | 🟢 низкая для лицензий | Это **не код**: лицензия сервиса на нашу лицензию не влияет. Требование: **не коммитить токены/ключи** в репозиторий (они лежат в `~/.config/goose/`, вне репо); в README — только имя провайдера |
| 8 | **goose (Apache-2.0) как sidecar** | 🟢 низкая | Мы его не встраиваем и (пока) не редистрибуем → obligation нет. При включении бинаря goose в наши релизы: приложить Apache-2.0 text + NOTICE |
| 9 | **Bun содержит JavaScriptCore (LGPL-2.1)** | 🟢 низкая | Релевантно только при редистрибуции bun; наш продукт — исходники + свои бинари, bun — пользовательская среда |
| 10 | **Проприетарных/commercial-пакетов в дереве зависимостей нет** (скан полей license и LICENSE-файлов: 0 совпадений) | ✅ | — |
| 11 | Типы `@types/*`, `typescript`, `bun-types` — dev-only | ✅ | В runtime-бандл/бинарь не поставляются; обязательств не порождают |
| 12 | `unicode-ident` несёт дополнительно `Unicode-3.0` термы | ✅ | Пермиссивная; только нельзя использовать названия Unicode как имена продуктов. Не проблема |

---

## 10. Метод и пробелы проверки

- **Читалось:** поля `license` всех 111 `package.json` в `node_modules` (+ скан текстов всех `LICENSE*` на copyleft-строки), поля `license` в `Cargo.toml` распакованных исходников всех 32 крейтов `Cargo.lock`, `strings` бинаря goose, `pacman -Qi bun`, шапка `sqlite3.c`.
- **Не проверялось (помечено явно):** legacy JS-дерево (нет node_modules), полное транзитивное legacy Rust-дерево, `appimage-runtime`, апстрим-URL пакетов (локальные файлы — источник истины; для решения о лицензии этого достаточно, т.к. это поле `license` из манифестов самих пакетов).
- **Неизвестных лицензий в активном стеке: 0** (кроме `appimage-runtime` и legacy JS — см. §5, §9).
