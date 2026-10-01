# Mayak Development (EN)

> Developer guide: build, checks, code conventions, config-sync, adding personalities and models.
> Repo rules and PR checklist: [../AGENTS.md](../AGENTS.md) (Russian) · Architecture: [architecture.en.md](architecture.en.md).

**Русская версия:** [development.ru.md](development.ru.md)

---

## 1. Stack and repo layout

| Path | Purpose | Status |
|---|---|---|
| `ui/mayak-ui/` | Active UI: GPUIX (`@gpuix/react` + `@gpuix/native` **0.10.0, pinned as a pair**), React 19, Bun, TypeScript 7 | ✅ |
| `ui/pantheon-ui-tauri-legacy/` | Old Tauri client | 🗄 **archive — do not touch** |
| `plugin/guard-rs/` | Rust guard (`pantheon-guard`) | ✅ |
| `plugin/hooks/`, `plugin/scripts/`, `plugin/mcp/` | hooks.json, bash scripts, MCP `pantheon_state.py` | ✅ |
| `agents/`, `recipes/` | Personalities and recipes (config-only) | ✅ |
| `sql/` | `schema.sql`, `migrations/` (by `user_version`), `migrate.sh` | ✅ |
| `packaging/`, `deploy.sh` | Packaging (legacy) and L0+L1 deploy | ✅ |

Entry points:

| Subsystem | Entry point |
|---|---|
| UI bootstrap | `ui/mayak-ui/app.tsx` → `render(App)` |
| Routing | `src/App.tsx` |
| ACP client | `src/acp.ts` (`AcpSession`) |
| API layer (Bun) | `src/api/*.ts` (`config`, `db`, `gooseServer`, `catalog`, `limits`, `clipboard`, `attachments`) |
| Guard | `plugin/guard-rs/` → binary `plugin/scripts/pantheon-guard` |
| MCP store | `plugin/mcp/pantheon_state.py` |

---

## 2. Build

```bash
# UI — dependencies (Bun)
cd ui/mayak-ui
bun install
# dev run
bun app.tsx

# Rust guard
cd plugin/guard-rs
cargo build --release
# result: target/release/pantheon-guard — guard-run.sh probes candidate paths
# (next to the script, target/release, ~/pantheon/plugin/guard-rs/target/release)

# Deploy L0+L1 (personalities, plugin, DB schema)
cd ~/pantheon && ./deploy.sh

# DB migrations
./sql/migrate.sh
```

GPUIX is pinned **as a pair only** — `@gpuix/react@0.10.0` + `@gpuix/native@0.10.0` (never bump one alone — it can pull a mismatched native binary). Pre-1.0: upgrade only as a pair, deliberately.

The legacy package (`packaging/build-pkg.sh`) builds the Tauri archive and is not used for mayak-ui.

---

## 3. Checks (all must be green)

```bash
# 1) mayak-ui types — 0 errors
cd ui/mayak-ui && bunx tsc --noEmit

# 2) smoke suite — 19/19
cd ui/mayak-ui && bun scripts/smoke.ts

# 3) guard policy — regression 24/24 (see §4)
# 4) Rust guard builds
cd plugin/guard-rs && cargo build --release
```

| Check | Acceptance criterion |
|---|---|
| `bunx tsc --noEmit` | **0 errors** |
| `bun scripts/smoke.ts` | **19/19 passed** (exit 0) |
| guard run | **24/24** (no `✗` lines) |
| `cargo build --release` | success |

What the smoke covers (`scripts/smoke.ts`, headless):
1. logger (`setLogSession`, `logged` fallback);
2. structured errors (`AppError`, `toAppError`, `tryOrAppErrorSync`);
3. db API (`openPantheon`, `listSessions`, `getPantheonOverview`, `listSubagentChildren`, `kvSet`);
4. config API (`getAgentChains`, `getConfigSummary`, `getConfigLimits`, `listPromptFiles`, auto-sync `saveAgentChain` → frontmatter);
5. catalog (`getProviderCatalog`);
6. state machine (6-state contract);
7. guard-rs (binary exists).

Additional tests (as needed): `scripts/api-test.ts` (API formats on temp config copies), `scripts/acp-contract-test.mjs` (ACP contract against live `goose serve`), `scripts/acp-smoke.ts`.

PR checklist — in [../AGENTS.md](../AGENTS.md) §11.

---

## 4. Guard: 24/24 regression

The policy is exercised against the live binary: a PreToolUse JSON payload is fed in, and the role is inserted into a test `runs` table. Reference runner (bash wrapper `t()`):

```bash
GUARD=~/pantheon/plugin/guard-rs/target/release/pantheon-guard
export PANTHEON_DB=/tmp/test-guard.db
# create the DB: sqlite3 $PANTHEON_DB < ~/pantheon/sql/schema.sql
t() { # t <name> <role> <tool> <extra-json> <allow|block>
  local sid="tf$RANDOM"
  sqlite3 "$PANTHEON_DB" "INSERT OR REPLACE INTO runs(session_id, role) VALUES('$sid', '$2');"
  local out; out=$(printf '%s' "{\"session_id\":\"$sid\",\"tool_name\":\"$3\"$4}" | $GUARD 2>/dev/null)
  local got=allow; echo "$out" | grep -q '"decision":"block"' && got=block
  [ "$got" != "$5" ] && echo "✗ $1 → $got (expect $5)"
}
```

The 24-case set (no `✗` lines → 24/24):

| # | Case | Role/tool | Expectation |
|---|---|---|---|
| 1 | oracle-plans | oracle, write `.pantheon/plans/p.md` | allow |
| 2 | oracle-analysis | oracle, write `.pantheon/analysis/a.md` | allow |
| 3 | oracle-evil | oracle, write `/tmp/evil.sh` | **block** |
| 4 | oracle-digests | oracle, write `.pantheon/digests/x.md` | **block** (not its path) |
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

After touching the guard, this run is **mandatory**; weakening the policy/whitelist requires justification in the PR (AGENTS.md §7/§10).

---

## 5. Code conventions

| Rule | Details |
|---|---|
| **Comment language** | **English only** in code (TS/Rust/bash/Python). No exceptions |
| **Errors** | Only `AppError` — `src/errors.ts`, `E.*` codes (`E.CONFIG_NOT_FOUND`, `E.GOOSE_STARTUP`, `E.ACP_NO_SESSION`, …). No raw `throw new Error(...)` |
| **Logs** | Only `log` — `src/logger.ts`. Format: `timestamp \| level \| module \| sid \| event \| detail`. Never an empty `catch {}` without `log.error`/`log.fail` |
| **State machine** | The session lifecycle is an explicit state machine (`VALID_TRANSITIONS`); new transitions go **only** into it |
| **Telemetry** | Record applied changes: `recordUsage(...)`, `auditConfigChange(...)`. Never remove these calls |
| **Stubs** | No empty catches, dead code or hollow TODOs; no features without AppError+logs |
| **GPUIX pitfalls** | `display:"flex"` is required for flex properties; `display:none` is ignored (use conditional JSX); `<text>` gets a single string child; nested scroll is forbidden (expandable, not inner overflow); `estimatedItemHeight` is mandatory; pin as a pair at 0.10.0 |

Log example:

```ts
log.error("session/load", `sessionId=${id} fallback=loadId`);
// 2026-09-29T21:40:12.345Z | ERROR | acp.ts | 20260929_3 | session/load | sessionId=undefined fallback=loadId
```

Error example:

```ts
throw new AppError(E.CONFIG_BAD_MODE, `unknown mode: ${mode}`, { context: { mode } });
// the UI shows userMessage; detail+code go to the log
```

---

## 6. Config-sync (critical)

A model change **must** be synced into three places at once:

1. `~/.config/goose/pantheon.toml` — chains (UI source);
2. frontmatter of `agents/<role>.md` → `model:`;
3. `recipes/<role>-*.yaml` → `settings.goose_model`.

The auto-sync lives in `saveAgentChain` (`ui/mayak-ui/src/api/config.ts`, internal `syncModelToRuntime`). **Always** use it; hand-patching one of the three breaks delegation (recipe/frontmatter beat the delegate override — the old model keeps running).

Model precedence in goose (`resolve_model_config`):
`recipe.settings.goose_model` → env `GOOSE_SUBAGENT_MODEL` → delegate `params.model` → configured → provider default.

`pantheon.toml` is **not** read by the delegate — it is the UI/documentation layer; editing it alone changes nothing.

---

## 7. Adding a personality (new role)

1. **`agents/<role>.md`** — frontmatter `name`, `description` (useWhen/avoidWhen triggers), `model:`; body — the system prompt. For a read-only role, spell out the path policy explicitly.
2. **`recipes/<role>-*.yaml`** — `settings.goose_provider`, `goose_model` (= frontmatter), `temperature`, `max_turns: 1000`, `extensions` (summon/developer/…).
3. **Guard policy** (`plugin/guard-rs/src/main.rs` + fallback `plugin/scripts/guard.sh`) — add the role to the write policy (like `oracle`/`metis` or `librarian`); an unknown role is treated as `adhoc`/`goose` — make sure SessionStart registers the role.
4. **Chains** — add an `[agents.<role>]` section in `pantheon.toml` and wire it into `saveAgentChain`/`getAgentChains` so the role shows up in ChainEditor when it supports fallback chains.
5. **Conductor** — describe invocation triggers in `agents/pantheon-conductor.md` (delegate source, escalation level, cost awareness).
6. **Spend** — the role flows into `usage_ledger`/the Panel automatically via `runs.role`; emoji/color — `PantheonPanel.tsx` (`ROLE_EMOJI`, `roleColor`).
7. **Deploy**: `./deploy.sh`; checks: `bunx tsc --noEmit`, `bun scripts/smoke.ts`, the guard run.
8. **Docs RU+EN** — update README/guide (convention: every notable feature in at least two editions).

Rollback note: no schema change (role is text), no migrations needed.

---

## 8. Adding / changing a model

1. Verify the model exists in the canonical catalog: `api/catalog.ts` (merges API `/v1/models` with the file-is-truth `~/.config/goose/opencode-go-models.json` — context_limit/modalities/prices live there).
2. Add/edit a chain step via **ChainEditor** ("Validate" → `validateChainStep`, maps 403/400) — the auto-sync then runs by itself.
3. Manual path (no UI): patch **all three** places (§6) or call `saveAgentChain` once.
4. Vision/text: check `modalities_in` (image) — otherwise subagents get "image was omitted"; the vision-model table is in the `subagent_system.md` prompt.
5. Prices for spend: the price file (`modelPrices()` in `api/db.ts`); without a price `cost` is NULL → "—" in the Panel.
6. Smoke: `bun scripts/smoke.ts` (the auto-sync case asserts the frontmatter).

---

## 9. Data schema and migrations

- Schema: `sql/schema.sql` (`runs`, `artifacts`, `projects`, `kv`, `handoffs`, `events`).
- The UI layer in `src/api/db.ts` idempotently creates `usage_ledger` and `events` (`CREATE TABLE IF NOT EXISTS`).
- Migrations: `sql/migrations/pantheon/`, `sql/migrations/sessions/` — files `NNN_*.sql` setting `PRAGMA user_version = N`; runner `sql/migrate.sh` (applies in order, logs to `guard.log`).
- `sessions.db` is read directly; only goose writes it.

---

## 10. Observability while developing

- Where the logs are: `~/.local/state/mayak-ui/mayak.log` (UI), `goose-serve.log` (sidecar), `~/.local/state/pantheon/guard.log` (plugin), `~/.local/state/goose/logs/llm_request.*.jsonl` (LLM payloads).
- UI log level: `MAYAK_LOG=debug`.
- Every new feature: AppError (or a graceful false) + entry/exit/error logs; "the failure point of any transaction must be findable from the log" is an acceptance item.
- Audit/usage calls (`auditConfigChange`, `recordUsage`) are mandatory on config-change and token-consumption paths.

---

*As of 2026-10-01 · Checks: tsc 0 · smoke 19/19 · guard 24/24*
