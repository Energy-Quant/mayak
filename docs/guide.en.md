# Mayak User Guide

> Purpose of this guide: installation, launch, everyday chat work, subagents, attachments, modes, the Mayak Panel and model settings.
> See also: [README.en.md](README.en.md) (overview) · [architecture.en.md](architecture.en.md) (how it works) · [../AGENTS.md](../AGENTS.md) (repo rules).

**Русская версия:** [guide.ru.md](guide.ru.md)

---

## 1. Installation

### Requirements

| Component | Version / why |
|---|---|
| [goose](https://github.com/block/goose) | **1.52.0** (ACP protocol, `auto/approve/smart_approve/chat` modes, `session/set_mode`) |
| [Bun](https://bun.sh) | runtime for mayak-ui (TypeScript/TSX, no build step) |
| Rust toolchain (`cargo`) | building guard-rs (`plugin/guard-rs`) |
| `jq`, `sqlite3`, `python3` | plugin hooks and the `pantheon_state.py` MCP |
| API provider access | e.g. OpenCode Go (keys live in `~/.config/goose/`, never committed) |

### Installing layers L0 + L1

```bash
cd ~/pantheon
./deploy.sh
```

The script:
- copies personalities `agents/*.md` → `~/.agents/agents/`;
- copies recipes `recipes/*.yaml` → `~/.config/goose/recipes/`;
- installs the plugin `plugin/` → `~/.agents/plugins/pantheon/`;
- applies `sql/schema.sql` to `~/.local/share/goose/pantheon.db`;
- writes `~/.config/environment.d/90-goose-subagent.conf` with `GOOSE_SUBAGENT_MAX_TURNS=1000` if missing.

Then verify `~/.config/goose/config.yaml`:

```yaml
extensions:
  orchestrator:
    enabled: true          # without it subagent delegation does not work
  pantheon-state:
    enabled: true
    type: stdio
    command: python3
    args: ["~/.agents/plugins/pantheon/mcp/pantheon_state.py"]
```

### Installing / launching the UI (L2)

```bash
cd ~/pantheon/ui/mayak-ui
bun install        # dependencies (GPUIX pinned as a pair: @gpuix/react + @gpuix/native 0.10.0)
bun app.tsx        # the "Mayak" window
```

Database migrations (after updating the repo):

```bash
cd ~/pantheon && ./sql/migrate.sh   # applies sql/migrations/* by user_version
```

---

## 2. Launch: mayak-ui and goose serve

On UI start the sidecar is brought up automatically:

1. `api/gooseServer.ts` spawns `goose serve` with `--allowed-origin` (exact-match origin list + secret) and `--enable-scheduler`;
2. the secret is passed as `?token=` in the WS URL (`GOOSE_SERVER__SECRET_KEY`), readiness-poll `/status` for up to 25 s;
3. sidecar stderr goes to `~/.local/state/mayak-ui/goose-serve.log`;
4. a healthy sidecar is reused (no zombie processes); it is killed only on start failure.

A manual `goose serve` start is **not needed** — the chat page auto-connects (`AcpSession.start()` → `session/new`).

If the connection drops:
- the **watchdog** (`acp.ts`) polls `/status` every 10 s and reconnects with backoff up to 8 s;
- the UI shows an error banner + a "reconnect" button.

---

## 3. Chat

Main flow (ChatPage):

- message → ACP `session/prompt` → streamed `session/update` (text, thinking, tool_call) → feed;
- **ctx meter** in the top bar: used tokens / model window (from `usage_update`) + a **"Compress"** button (`/compact`);
- **↓** button — floating scroll-to-bottom: jump to the newest message when you have scrolled up;
- **New chat** — a clean `session/new`; switching chats goes through the sidebar/History (`session/load` with history replay);
- goose's own slash commands (`/status`, `/model`, `/mode`, `/compact`, …) work when typed manually into the input.

Connection states follow an explicit state machine: `idle → connecting → ready → streaming → closed` (+ `error`); invalid transitions are ignored and logged.

### Operating modes (goose 1.52)

Settings → "User interface" tab → **goose mode**:

| UI label | `GOOSE_MODE` value | Behaviour |
|---|---|---|
| **Autonomous** | `auto` | Full execution: files, runs, extensions without confirmations |
| **Manual** | `approve` | Every action requires human confirmation |
| **Approve** | `smart_approve` | Minimal confirmations, based on risk level |
| **Chat** | `chat` | Conversation/plans only: tools are not invoked |

How the mode is applied:
- the change is written to `config.yaml` (`GOOSE_MODE`) — applies to **new** sessions;
- for a **live** session the UI additionally sends ACP `session/set_mode` (applies immediately; the indicator updates from `current_mode_update`).

**Permissions.** `session/request_permission` requests are logged (`acp.permission.request`) and **denied by default**: auto-allow happens only in the explicit `auto` mode; otherwise, without an explicit user choice — deny (fail-safe). A UI permission dialog is under development (see [goose-152-compat.md](goose-152-compat.md), "Critical gaps").

---

## 4. Subagents: Oracle, Librarian, Metis

Mayak is **not a separate subagent chat** — it is a layer over the goose orchestrator. The main agent (the conductor, `pantheon-conductor.md`) decides whom to delegate to:

| When | Who | How |
|---|---|---|
| Unfamiliar library/docs/API | **Librarian** (cheap, parallel) | `delegate(source: librarian)` |
| Complex plan / architecture / 2+ failed fixes | **Oracle** (expensive, deep) | `delegate(source: oracle)` — after Librarian digests |
| Plan review before implementation (HIGH/CRIT) | **Metis** (adversarial critic) | `delegate(source: metis)` — after Oracle's plan |

Conductor rules (baked into `agents/pantheon-conductor.md`):
- **LOW** → do it yourself, no delegation;
- **MED** → your judgment, Librarian allowed;
- **HIGH** → Oracle plan (Librarian first if the domain is unfamiliar);
- **CRIT** → full chain: Librarian (if context needed) → Oracle → **Metis** → only then implementation; never skip Metis on CRIT;
- CRIT/HIGH Metis findings go back to Oracle for a plan revision (at most 2 rounds).

### Auto-escalation `[ESCALATION:LEVEL]`

The `UserPromptSubmit` hook (`plugin/scripts/escalate.sh`) classifies **every** user prompt by keywords (RU+EN) and length:
- score 0 → `LOW`, 1–3 → `MED`, 4–7 → `HIGH`, ≥8 → `CRIT`;
- a tag `[ESCALATION:LOW|MED|HIGH|CRIT]` is prepended to the prompt;
- the conductor must treat the tag as the complexity verdict (its own judgment may raise the level, never lower it);
- the hook never fails: any error = "no tag" (exit 0).

### How it looks in the UI

- delegate calls appear in the feed as tool-calls (source + instructions);
- the right **rail** lists the current session's subagents (event-driven: tool_call with `_meta.subagent_session_id` + reconciliation every 15 s);
- clicking a subagent opens **SubagentStream**: its turns (task / move / answer, thinking, tool-chips), polling `sessions.db` every 2 s;
- Esc/✕ closes the stream and returns to the main chat.

Personality artifacts live in `.pantheon/` (relative to the session working directory):
`plans/`, `analysis/` (Oracle/Metis), `digests/` (Librarian).

---

## 5. Attachments

Ways to attach a file to the chat:
- **Ctrl+V** — an image from the clipboard (via `wl-paste`);
- **drag & drop** onto the window (GPUIX `onFileDrop`, absolute OS paths);
- **paperclip** — file picker.

What happens next:
- images are compressed to ≤1024 px (JPEG q85, ImageMagick; original if magick is missing) and sent as ACP **image blocks**;
- documents are staged into `~/.cache/goose/mayak-attachments/` (25 MB limit), the path is inserted into the prompt text;
- preview chips above the input (8-attachment limit).

Subagents receive images through the `sessionImagePaths` registry: the path lands in the delegate prompt text and the subagent reads it with `read_image` (as its first action). The path from the prompt is the single source of truth: inventing `/tmp` paths is forbidden.

---

## 6. Mayak Panel (spend, audit, state)

**Settings → "State" tab** (or the panel item) → "Mayak Panel":

| Section | What it shows |
|---|---|
| **RUNS** | running/finished session runs: role, status, model, time, sid |
| **ROLES** | per-role aggregates (oracle/librarian/metis/goose): sessions, statuses |
| **SPEND · 7 DAYS** | per-role spend: input/output tokens and **USD** for 7 days (source — `usage_ledger`, fed from ACP `usage_update`; cost is computed from the model price file when the API does not provide it) |
| **ARTIFACTS** | `.pantheon/*` files (plan/digest/analysis) with topic and session |
| **CHANGE HISTORY** | config change audit: actor, what changed, old/new value hashes, previews, time |

Data: `pantheon.db` (`runs`, `usage_ledger`, `events`, `artifacts`, `kv`).
Audit records are created centrally via `auditConfigChange(...)` — every UI config change goes through it.

Also in the UI:
- **UsageBar** — OpenCode Go subscription limits (5 h/week/month windows, polls `/v1/usage` every 30 s);
- **Session history** — chat list from `sessions.db`, click to open;
- **ctx meter** — current session tokens relative to the model window.

---

## 7. Model settings

### Model chains (primary + fallbacks)

Settings → **"Models"** tab → ChainEditor: each role (goose, oracle, librarian, metis) has a primary model and a list of fallbacks.

⚠️ **Sync rule:** a model change MUST be reflected in three places at once:

1. `~/.config/goose/pantheon.toml` — chains (source for the UI);
2. frontmatter of `~/.agents/agents/<role>.md` → `model:`;
3. `~/.config/goose/recipes/<role>-*.yaml` → `settings.goose_model`.

The auto-sync runs inside `saveAgentChain` (`ui/mayak-ui/src/api/config.ts`) — **never patch the files piecemeal** by hand. Model precedence on delegate: recipe/frontmatter **beat** the `model:` override in delegate (`pantheon.toml` is UI/documentation — alone it is not enough).

Current chains (OpenCode Go, `pantheon.toml`): see the table in [README.en.md](README.en.md).

### Active model (global)

Settings → "Models" → active model/provider → written to `config.yaml` **with a backup**. Applies to new sessions (for on-the-fly switching goose provides `/model` and `session/set_mode` — integration is on the roadmap, see compat).

### Validation

"Validate" in ChainEditor → `validateChainStep` (mini API request, maps 403/400 errors) — prevents saving a broken chain step.

### Prompt editor

Settings → **"Programs"** — editing `~/.config/goose/prompts/*.md` (whitelist of 7 files: `system.md`, `subagent_system.md`, `compaction.md`, `permission_judge.md`, …) with a `.bak` backup.

### Limits

Settings → **"Application"**: `GOOSE_MAX_TURNS`, `GOOSE_AUTO_COMPACT_THRESHOLD` — read + display (editing from the UI is roadmap P1).

---

## 8. Extensions, history, misc

- **Extensions** — toggle `extensions.*.enabled` in `config.yaml` (backup `.yaml.bak-mayak`), including `orchestrator`, `pantheon-state`, `skills`;
- **Session history** — opening an old chat with replay (`session/load`); subagents in history — drill-down stream;
- **Recipes** — list of `~/.config/goose/recipes/` (parity with `goose recipe list`);
- **Scheduler** — jobs from `~/.local/share/goose/schedule.json` (view only; add/pause is roadmap P1 — goose runs with `--enable-scheduler`);
- **Apps** — stored app list + open; creation happens via the apps tools in chat.

---

## 9. Diagnostics

| What | Where |
|---|---|
| UI logs | `~/.local/state/mayak-ui/mayak.log` (rotation 5 MB × 3; level via env `MAYAK_LOG=debug\|info\|warn\|error`) |
| Sidecar logs | `~/.local/state/mayak-ui/goose-serve.log` |
| Plugin logs (guard/hooks/MCP) | `~/.local/state/pantheon/guard.log` |
| goose LLM requests | `~/.local/state/goose/logs/llm_request.*.jsonl` (rotation keep=10) |
| Log format | `timestamp \| level \| module \| sid \| event \| detail` |

Observability criterion: the failure point of any transaction must be findable in the log. Example:

```
2026-09-29T21:40:12.345Z | ERROR | acp.ts | 20260929_3 | session/load | sessionId=undefined fallback=loadId
```

---

## 10. FAQ

**Q: "[object Event]" on connect / zombie goose serve?**
That was an Origin 403 (Tauri/`tauri://localhost`); the current UI passes an exact-list `--allowed-origin` + secret and reuses a healthy sidecar. Check `goose-serve.log`.

**Q: The subagent uses a different model than expected?**
Precedence: recipe/frontmatter → delegate override. Check all three sync places (§7) — `pantheon.toml` alone is not enough.

**Q: The subagent does not see the image?**
The model has no `image` modality (e.g. `glm-5.3` is text-only) → goose sends "image was omitted". Switch the chain to a vision model (mimo-v2.6-pro/flash, glm-5.3-flash, kimi-k3, gpt-5.6-luna, deepseek-v4.1-flash).

**Q: Someone writes outside `.pantheon/`?**
guard-rs blocks it (`on_failure: block`), the reason and role are written to `guard.log`. The guard must not be weakened (see AGENTS.md §7).

**Q: Did `goose update` roll back my version?**
Yes — the official release can be older than your manual 1.52 build; do not run `goose update` until the official version catches up.
