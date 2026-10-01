# Mayak Documentation (EN)

> **Mayak** (ex-"Pantheon" / ex-Pantheon) — an open-source multi-agent overlay for [goose](https://github.com/block/goose): personalities on different models, a read-only guard layer, automatic complexity escalation, spend tracking and a split-view UI.
> License: **MIT** · Third-party dependencies: permissive only (GPUIX and goose are Apache-2.0, no copyleft) → see [licenses-audit.md](licenses-audit.md).

**Русская версия:** [README.md](README.md)

---

## What is Mayak

Mayak is a three-layer stack on top of the `goose serve` sidecar (ACP / WebSocket):

| Layer | What it is | Repo location | Status |
|---|---|---|---|
| **L0 — Personalities** | Config-only: `oracle.md`, `librarian.md`, `pantheon-metis.md`, `pantheon-conductor.md` + recipe model chains | `agents/`, `recipes/` | ✅ config-only |
| **L1 — Control plugin** | Hooks (SessionStart/PreToolUse/UserPromptSubmit/PostToolUse/SessionEnd), **guard-rs** (Rust read-only enforcement), auto-escalation, MCP state tools | `plugin/` | ✅ |
| **L2 — UI client** | **mayak-ui** on GPUIX (React layer, no webview): chat, subagents, settings, Mayak Panel | `ui/mayak-ui/` | ✅ active stack |
| L2' — Tauri client | Legacy Tauri client | `ui/pantheon-ui-tauri-legacy/` | 🗄 archive, not built |

Data stores: `pantheon.db` (runs / artifacts / kv / events / usage_ledger), `sessions.db` (goose sessions), `pantheon.toml` (model chains), `~/.config/goose/config.yaml`.

### Personalities

| Role | What it does | May write to | Model (primary, rev) |
|---|---|---|---|
| **Oracle** | Strategic thinking, plans, architecture | only `.pantheon/{plans,analysis}/*.md` | `opencode_go/mimo-v2.6-pro` |
| **Librarian** | Docs/source research, digests with permalinks | only `.pantheon/digests/*.md` | `opencode_go/mimo-v2.6-flash` |
| **Metis** | Plan critic: attacks plans, hunts weaknesses/risks/holes | only `.pantheon/{plans,analysis}/*.md` | `opencode_go/mimo-v2.6-pro` |
| **Goose/conductor** | Orchestrator + executor (main chat) | unrestricted | `opencode_go/mimo-v2.6-flash` |

All three personalities are **read-only**: any write outside their paths is blocked by the guard at `PreToolUse` (`on_failure: block`).

---

## Quick start

```bash
# 1) Requirements: goose 1.52, bun, cargo, jq, sqlite3, python3
goose --version          # 1.52.0+

# 2) Install layers L0 + L1 (personalities, plugin, DB, env)
cd ~/pantheon
./deploy.sh

# 3) Verify ~/.config/goose/config.yaml:
#    extensions.orchestrator.enabled: true
#    extensions.pantheon-state (stdio → python3 ~/.agents/plugins/pantheon/mcp/pantheon_state.py)

# 4) Launch the UI (L2)
cd ui/mayak-ui && bun install && bun app.tsx
# The UI spawns the `goose serve` sidecar itself (allowed-origin + secret) — no manual start needed
```

Details (chat, subagents, modes, attachments, panel): **[guide.en.md](guide.en.md)**.

---

## Documentation index

| Document | EN | RU | About |
|---|---|---|---|
| Home | **you are here** | [README.md](README.md) | Overview, layers, quick start |
| User guide | [guide.en.md](guide.en.md) | [guide.ru.md](guide.ru.md) | Install, chat, subagents, modes, attachments, panel, model settings |
| Architecture | [architecture.en.md](architecture.en.md) | [architecture.ru.md](architecture.ru.md) · [architecture.md](architecture.md) | 3 layers, data flows, state machine, guard, watchdog, logging |
| For developers | [development.en.md](development.en.md) | [development.ru.md](development.ru.md) | Build, checks (tsc/smoke/guard), conventions, config-sync, adding personalities |
| goose 1.52 compatibility | [goose-152-compat.md](goose-152-compat.md) | — | Full feature audit (10 categories, priorities P0–P3) |
| License audit | [licenses-audit.md](licenses-audit.md) | — | 111 JS + 32 Rust dependencies, MIT recommendation |
| Repo rules | [../AGENTS.md](../AGENTS.md) | — | Code conventions, prohibitions, PR checklist |

---

## Key features (short)

- **Three layers + conductor** — task distribution by complexity level; subagent delegation goes through the goose orchestrator.
- **Auto-escalation** — the `UserPromptSubmit` hook (`escalate.sh`) classifies every prompt as `LOW/MED/HIGH/CRIT` and prepends an `[ESCALATION:LEVEL]` tag; the conductor reacts: LOW → do it yourself, HIGH → Oracle, CRIT → full chain (Librarian → Oracle → Metis).
- **Metis** — the plan-critic personality (adversarial review): attacks the plan before implementation, produces a severity-ranked vulnerability list; it never rewrites plans.
- **guard-rs** — a Rust guard on `PreToolUse`: per-role write-targeting policy + a read-only shell whitelist (segment-wise: pipes, redirects, backtick/`$()`, background, git/sqlite3/python/sed). Fail-safe: any guard failure = block. Regression suite **24/24**.
- **goose 1.52 modes** — `auto | approve | smart_approve | chat` in Settings; a live session receives the mode via ACP `session/set_mode`, new sessions via `GOOSE_MODE` in `config.yaml`.
- **Permission DENY by default** — `session/request_permission` is never silently allowed: auto-allow only in the explicit `auto` mode, otherwise deny with logging (`acp.permission.*`).
- **Watchdog** — health-checks `goose serve` (`/status`) every 10 s, reconnect with backoff up to 8 s, session resurrect; generation guards and the `start/load` queue eliminate races.
- **Session state machine** — `idle → connecting → ready → streaming → closed` (+ `error`); invalid transitions are ignored and logged.
- **End-to-end logging** — one format `timestamp | level | module | sid | event | detail` across TS/Rust/Python/bash; no `catch {}` without a log entry.
- **Per-role spend** — `usage_update` → `usage_ledger` → Panel: "SPEND · 7 DAYS" (in/out tokens, USD priced from the model price file).
- **Config change audit** — `auditConfigChange` writes into `pantheon.db events` (hash + old/new preview); Panel → "CHANGE HISTORY".
- **Scroll-to-bottom button** — a floating "jump to latest message" button over the feed (overlay, no nested scroll — the GPUIX rule).
- **Subagents** — event-driven rail (tool_call with `_meta.subagent_session_id` + reconciliation), live SubagentStream, image delivery via the `[imgs]` registry and auto-context.
- **OpenCode Go limits** — UsageBar: 5 h/week/month windows (polls `/v1/usage` every 30 s).

---

## License

The project is **MIT** — see [../LICENSE](../LICENSE).

- The MIT choice is backed by the audit: [licenses-audit.md](licenses-audit.md) — **there are no copyleft dependencies**.
- Compatibility: GPUIX (`@gpuix/*`) is Apache-2.0, the goose sidecar is Apache-2.0 (does not affect Mayak's license), the rest are MIT / BSD-3-Clause / ISC.
- New dependencies must be permissive only; GPL/AGPL/SSPL are prohibited (see [../AGENTS.md](../AGENTS.md) §8).
