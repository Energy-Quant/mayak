# Mayak (ex-Pantheon)

**Mayak** is an open-source multi-agent orchestration layer over [goose](https://github.com/block/goose): **Oracle** (reasoning), **Librarian** (research), **Metis** (plan critique), and **Goose/Conductor** (orchestrator + executor) — with a read-only guard loop, auto-escalation of complexity, per-role cost tracking, and a native GPUIX desktop client.

License: [MIT](LICENSE) · Docs: [docs/README.en.md](docs/README.en.md) (EN) · [docs/README.md](docs/README.md) (RU)

## Layers

| Layer | What it is | Status | Where |
|---|---|---|---|
| **L0 — Personalities** (config-only) | `oracle`, `librarian`, `metis`, `conductor` + model-chain recipes | ✅ Phase 0 | `agents/` → `~/.agents/agents/`, `recipes/` → `~/.config/goose/recipes/` |
| **L1 — Control plugin** | hooks (PreToolUse guard, auto-escalation, audit), **guard-rs** (Rust), MCP store, `pantheon.db` | ✅ Phase 1 | `plugin/` → `~/.agents/plugins/pantheon/` |
| **L2 — mayak-ui** | chat (ACP), subagent rail/stream, settings, Mayak Panel (costs/audit), ctx-meter, limits | ✅ Phase 3–4 | `ui/mayak-ui/` — **active stack (GPUIX)** |
| L2' — Tauri client | legacy client | 🗄 archive | `ui/pantheon-ui-tauri-legacy/` — do not touch |

## Documentation

| Document | EN | RU |
|---|---|---|
| Overview, quick start | [docs/README.en.md](docs/README.en.md) | [docs/README.md](docs/README.md) |
| User guide (chat, subagents, modes, attachments, Panel, models) | [docs/guide.en.md](docs/guide.en.md) | [docs/guide.ru.md](docs/guide.ru.md) |
| Architecture (layers, flows, state machine, guard, watchdog, logs) | [docs/architecture.en.md](docs/architecture.en.md) · [docs/architecture.md](docs/architecture.md) (graph map) | [docs/architecture.ru.md](docs/architecture.ru.md) |
| Development (build, checks, conventions, config-sync) | [docs/development.en.md](docs/development.en.md) | [docs/development.ru.md](docs/development.ru.md) |
| goose 1.52 compatibility (feature audit, P0–P3) | [docs/goose-152-compat.md](docs/goose-152-compat.md) | — |
| License audit (111 JS + 32 Rust, no copyleft) | [docs/licenses-audit.md](docs/licenses-audit.md) | — |
| Repo rules / PR checklist | [AGENTS.md](AGENTS.md) | — |

## Models (OpenCode Go, `~/.config/goose/pantheon.toml`)

| Role | Primary | Fallbacks |
|---|---|---|
| Goose (conductor) | `opencode_go/mimo-v2.6-flash` | `deepseek-v4.1-flash` → `qwen3.8-flash` → `mimo-v2.6-flash` |
| Oracle | `opencode_go/mimo-v2.6-pro` | `glm-5.3-flash` → `minimax-m3` → `gpt-5.6-luna` |
| Metis | `opencode_go/mimo-v2.6-pro` | `glm-5.3-flash` → `minimax-m3` → `gpt-5.6-luna` |
| Librarian | `opencode_go/mimo-v2.6-flash` | `glm-5.3-flash` → `qwen3.8-flash` |

⚠️ Model changes are synced **automatically** to three places (`pantheon.toml` + `agents/*.md` frontmatter + `recipes/*.yaml`) via `saveAgentChain` — never edit them piecemeal.

## Install & run

```bash
# L0 + L1: personalities, plugin, DB, env
./deploy.sh                      # requires jq, sqlite3, python3

# L2: UI
cd ui/mayak-ui && bun install && bun app.tsx   # goose serve starts automatically

# Checks (all green — acceptance gate)
cd ui/mayak-ui && bunx tsc --noEmit            # 0 errors
cd ui/mayak-ui && bun scripts/smoke.ts         # smoke suite
cd ui/mayak-ui && bun scripts/unit-test.ts     # unit tests
cd plugin/guard-rs && cargo test --release     # guard policy tests
python3 plugin/mcp/test_pantheon_state.py      # MCP tool tests
```

In `~/.config/goose/config.yaml`: `extensions.orchestrator.enabled: true`, and the `pantheon-state` extension (stdio → `plugin/mcp/pantheon_state.py`).

## Security (guard)

- **Oracle/Metis** write only `.pantheon/plans|analysis/*.md`; **Librarian** — only `.pantheon/digests/*.md`; both run shell under a read-only whitelist (per-segment checks of pipes/redirects/backtick/`$()`/background, git/sqlite3/python/sed).
- **goose/adhoc** — unrestricted; guard failure → `on_failure: block` (fail-safe).
- UI permissions are **DENY by default** (auto-allow only in `auto` mode); goose 1.52 modes: `auto | approve | smart_approve | chat`.
- Policy regression: guard tests in `plugin/guard-rs` (24 cases).

## Branching model

| Branch | Purpose | Push |
|---|---|---|
| `main` | stable (bug rate &lt; 5%), releases | no direct push — PR only, owner + trusted maintainers |
| `dev` | integration, unstable | maintainers merge feature branches here |
| `feature-*` | features / fixes, branch from `dev` | branch creators |
| `v*` tags | stable releases | created from `main` via CI/CD |

## CI/CD

GitHub Actions (`.github/workflows/`):
- **`ci.yml`** — runs `tsc` + smoke + unit tests (mayak-ui), `cargo test` (guard-rs), and python tests on every push/PR to `main`, `dev`, `feature/**`.
- **`release.yml`** — on `v*` tag push, builds `mayak-ui` + `pantheon-guard` binaries and publishes a GitHub Release.

## License

**MIT** — see [LICENSE](LICENSE). Chosen per [docs/licenses-audit.md](docs/licenses-audit.md): no copyleft dependencies; GPUIX and the goose sidecar are Apache-2.0 (does not affect Mayak's license), the rest are MIT/BSD-3-Clause/ISC. New dependencies must be permissive only.
