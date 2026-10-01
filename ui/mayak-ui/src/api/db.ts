/**
 * api/db.ts — port of db.rs (+ panel from pantheon.rs) to bun:sqlite.
 * Response shapes are BYTE-FOR-BYTE identical to the Tauri commands (components are not rewritten).
 * pantheon.db — read-write only for kv audit; sessions.db — strictly readonly.
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { log, logged } from "../logger";
import { AppError, E } from "../errors";

export const pantheonDbPath = () => join(homedir(), ".local/share/goose/pantheon.db");
const sessionsDbPath = () => join(homedir(), ".local/share/goose/sessions/sessions.db");

/** CREATE TABLE IF NOT EXISTS (runs, kv) + open — same as open() in db.rs */
export function openPantheon(): Database {
  const path = pantheonDbPath();
  try {
    mkdirSync(join(path, ".."), { recursive: true });
  } catch (e) {
    throw new AppError(E.DB_OPEN, `mkdir: ${e instanceof Error ? e.message : e}`, { context: { path } });
  }
  let conn: Database;
  try {
    conn = new Database(path);
  } catch (e) {
    throw new AppError(E.DB_OPEN, `open pantheon.db: ${e instanceof Error ? e.message : e}`, { context: { path } });
  }
  conn.run(`CREATE TABLE IF NOT EXISTS runs (
      session_id TEXT PRIMARY KEY, parent_session_id TEXT,
      role TEXT NOT NULL DEFAULT 'adhoc', status TEXT DEFAULT 'running',
      task_summary TEXT, model TEXT,
      started_at TEXT DEFAULT (datetime('now')), finished_at TEXT);`);
  conn.run(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT,
      updated_at TEXT DEFAULT (datetime('now')));`);
  // Usage ledger: usage_update samples, aggregated per role by the panel.
  conn.run(`CREATE TABLE IF NOT EXISTS usage_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      role TEXT, model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL, created_at TEXT DEFAULT (datetime('now')));`);
  conn.run(`CREATE INDEX IF NOT EXISTS idx_usage_ledger_created ON usage_ledger(created_at);`);
  // Config audit trail — same shape as the backend events table (no-op if present).
  conn.run(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, session_id TEXT,
      event TEXT, tool_name TEXT, detail TEXT,
      created_at TEXT DEFAULT (datetime('now')));`);
  return conn;
}

function openSessions(): Database {
  const path = sessionsDbPath();
  try {
    return new Database(path, { readonly: true });
  } catch (e) {
    throw new AppError(E.DB_OPEN, `open sessions.db: ${e instanceof Error ? e.message : e}`, { context: { path } });
  }
}

export interface RunRow {
  session_id: string;
  role: string;
  status: string;
  task_summary: string | null;
  model: string | null;
}

export function recentRuns(): RunRow[] {
  const conn = openPantheon();
  const rows = conn
    .query(
      `SELECT session_id, role, status, task_summary, model FROM runs
       ORDER BY started_at DESC LIMIT 15`,
    )
    .all() as RunRow[];
  conn.close();
  return rows;
}

export interface SessionRow {
  id: string;
  title: string;
  session_type: string;
  parent_session_id: string | null;
  updated_at: string;
  total_tokens: number;
  running: boolean;
}

/**
 * Session children (sub_agent) — direct query by parent_session_id.
 * NOT via listSessions: it applies LIMIT 100 on updated_at and loses children
 * of old sessions (parent in the top 100, children — not).
 */
export function listSubagentChildren(parentId: string): SessionRow[] {
  let running = new Set<string>();
  try {
    const conn = openPantheon();
    const rs = conn
      .query("SELECT session_id FROM runs WHERE status='running'")
      .all() as { session_id: string }[];
    running = new Set(rs.map((r) => r.session_id));
    conn.close();
  } catch (e) {
    log.fail("db.running-flags", e);
  }

  const conn = openSessions();
  const rows = conn
    .query(
      `SELECT id, name, description, session_type, updated_at, total_tokens, parent_session_id
       FROM sessions
       WHERE archived_at IS NULL AND parent_session_id = ? AND session_type = 'sub_agent'
       ORDER BY updated_at DESC LIMIT 30`,
    )
    .all(parentId) as {
    id: string;
    name: string;
    description: string;
    session_type: string;
    updated_at: string;
    total_tokens: number | null;
    parent_session_id: string | null;
  }[];
  conn.close();

  return rows.map((r) => ({
    id: r.id,
    title:
      r.name === ""
        ? r.description === ""
          ? "Без названия"
          : [...r.description].slice(0, 60).join("")
        : r.name,
    session_type: r.session_type,
    parent_session_id: r.parent_session_id,
    updated_at: r.updated_at,
    total_tokens: r.total_tokens ?? 0,
    running: running.has(r.id),
  }));
}

/** Session history (sessions.db readonly) + running flag from pantheon.db */
export function listSessions(onlyRunning = false): SessionRow[] {
  let running = new Set<string>();
  try {
    const conn = openPantheon();
    const rs = conn
      .query("SELECT session_id FROM runs WHERE status='running'")
      .all() as { session_id: string }[];
    running = new Set(rs.map((r) => r.session_id));
    conn.close();
  } catch (e) {
    log.fail("db.running-flags", e);
  }

  const conn = openSessions();
  const rows = conn
    .query(
      `SELECT id, name, description, session_type, updated_at, total_tokens, parent_session_id
       FROM sessions WHERE archived_at IS NULL
       ORDER BY updated_at DESC LIMIT 100`,
    )
    .all() as {
    id: string;
    name: string;
    description: string;
    session_type: string;
    updated_at: string;
    total_tokens: number | null;
    parent_session_id: string | null;
  }[];
  conn.close();

  const out: SessionRow[] = [];
  for (const r of rows) {
    const isRunning = running.has(r.id);
    if (onlyRunning && !isRunning) continue;
    const title =
      r.name === ""
        ? r.description === ""
          ? "Без названия"
          : [...r.description].slice(0, 60).join("")
        : r.name;
    out.push({
      id: r.id,
      title,
      session_type: r.session_type,
      parent_session_id: r.parent_session_id,
      updated_at: r.updated_at,
      total_tokens: r.total_tokens ?? 0,
      running: isRunning,
    });
  }
  return out;
}

export function kvSet(key: string, value: string): void {
  try {
    const conn = openPantheon();
    conn.query(
      `INSERT INTO kv(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
    ).run(key, value);
    conn.close();
  } catch (e) {
    log.fail("db.kvSet", e); // audit must never break the operation
  }
}

// ── Usage ledger: per-role token spend (usage_update → recordUsage → panel) ──

const MODELS_TRUTH_PATH = join(homedir(), ".config/goose/opencode-go-models.json");

interface ModelPrice {
  in: number; // USD per 1M input tokens
  out: number; // USD per 1M output tokens
}

let priceCache: Map<string, ModelPrice> | null = null;

/**
 * Model price lookup. api/catalog exposes no price field, so we read the same
 * file-is-truth JSON catalog.ts already uses (price_in_per_1m/price_out_per_1m).
 * Unknown model → null: callers show "—" instead of inventing numbers.
 */
function modelPrices(): Map<string, ModelPrice> {
  if (priceCache) return priceCache;
  priceCache = new Map();
  try {
    const raw = readFileSync(MODELS_TRUTH_PATH, "utf8");
    const v = JSON.parse(raw) as { models?: Record<string, unknown>[] };
    for (const m of v.models ?? []) {
      const id = typeof m.id === "string" ? m.id : null;
      const pin = typeof m.price_in_per_1m === "number" ? m.price_in_per_1m : null;
      const pout = typeof m.price_out_per_1m === "number" ? m.price_out_per_1m : null;
      if (id !== null && pin !== null && pout !== null) priceCache.set(id, { in: pin, out: pout });
    }
  } catch (e) {
    log.debug("db.modelPrices", e instanceof Error ? e.message : String(e));
  }
  return priceCache;
}

/** Price by model id; accepts "provider/model" and plain "model" forms. */
function priceFor(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  const prices = modelPrices();
  const base = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  return prices.get(base) ?? prices.get(model) ?? null;
}

export interface UsageInput {
  session_id: string;
  model?: string | null;
  role?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  /** USD — omitted means "derive from the model price file" (null = unknown). */
  cost?: number | null;
}

/**
 * Append one usage sample to usage_ledger (wire-up point for usage_update).
 * Telemetry contract, same as kvSet: must never break the caller —
 * failures are logged and reported as false.
 */
export function recordUsage(u: UsageInput): boolean {
  try {
    const conn = openPantheon();
    let role = u.role ?? null;
    if (!role) {
      const r = conn
        .query("SELECT role FROM runs WHERE session_id = ?")
        .get(u.session_id) as { role: string } | null;
      role = r?.role ?? null;
    }
    const inTok = Math.max(0, Math.round(u.input_tokens ?? 0));
    const outTok = Math.max(0, Math.round(u.output_tokens ?? 0));
    let cost = u.cost ?? null;
    if (cost === null) {
      const p = priceFor(u.model);
      if (p) cost = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
    }
    conn
      .query(
        `INSERT INTO usage_ledger(session_id, role, model, input_tokens, output_tokens, cost)
         VALUES(?, ?, ?, ?, ?, ?)`,
      )
      .run(u.session_id, role, u.model ?? null, inTok, outTok, cost);
    conn.close();
    log.info(
      "db.usage.record",
      `sid=${u.session_id} role=${role ?? "-"} model=${u.model ?? "-"} in=${inTok} out=${outTok} cost=${cost === null ? "-" : cost.toFixed(6)}`,
    );
    return true;
  } catch (e) {
    log.fail("db.usage.record", e);
    return false;
  }
}

export interface RoleUsage {
  role: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  /** null when no priced sample exists for the role (shown as "—"). */
  cost_usd: number | null;
  sessions: number;
  models: string[];
}

/** Aggregate usage_ledger per role for the last `days` days, joined with runs.role. */
export function getRoleUsage(days = 7): RoleUsage[] {
  let rows: {
    role: string;
    in_tok: number | null;
    out_tok: number | null;
    cost: number | null;
    sessions: number | null;
    models: string | null;
  }[];
  try {
    const conn = openPantheon();
    rows = conn
      .query(
        `SELECT coalesce(r.role, u.role, 'adhoc') AS role,
                sum(u.input_tokens) AS in_tok, sum(u.output_tokens) AS out_tok,
                sum(u.cost) AS cost, count(DISTINCT u.session_id) AS sessions,
                GROUP_CONCAT(DISTINCT u.model) AS models
         FROM usage_ledger u
         LEFT JOIN runs r ON r.session_id = u.session_id
         WHERE u.created_at >= datetime('now', ?)
         GROUP BY 1
         ORDER BY (sum(u.input_tokens) + sum(u.output_tokens)) DESC`,
      )
      .all(`-${days} days`) as typeof rows;
    conn.close();
  } catch (e) {
    throw new AppError(E.DB_QUERY, `usage aggregate: ${e instanceof Error ? e.message : e}`, {
      context: { days },
    });
  }

  const out: RoleUsage[] = rows.map((r) => ({
    role: r.role,
    input_tokens: r.in_tok ?? 0,
    output_tokens: r.out_tok ?? 0,
    total_tokens: (r.in_tok ?? 0) + (r.out_tok ?? 0),
    cost_usd: r.cost === null ? null : Math.round(r.cost * 1e6) / 1e6,
    sessions: r.sessions ?? 0,
    models: (r.models ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m !== ""),
  }));
  const total = out.reduce((s, r) => s + r.total_tokens, 0);
  log.info("db.usage.read", `days=${days} roles=${out.length} tokens=${total}`);
  return out;
}

// ── Config audit: who changed what, when (hashes only, no raw values) ──

const shortHash = (s: string): string =>
  createHash("sha256").update(s ?? "").digest("hex").slice(0, 12);

export interface AuditEntry {
  id: number;
  /** role or session id of the editor */
  actor: string;
  what: string;
  old_hash: string;
  new_hash: string;
  created_at: string;
}

/**
 * Single audit entry point for any config change. Writes into pantheon.db
 * events with old/new value hashes (values themselves stay out of the DB,
 * only short previews). Never throws — auditing must not block the change.
 */
export function auditConfigChange(
  actor: string,
  what: string,
  oldValue: string,
  newValue: string,
): void {
  try {
    const oldHash = shortHash(oldValue);
    const newHash = shortHash(newValue);
    const detail = JSON.stringify({
      old_hash: oldHash,
      new_hash: newHash,
      old_preview: String(oldValue ?? "").slice(0, 160),
      new_preview: String(newValue ?? "").slice(0, 160),
    });
    const conn = openPantheon();
    conn
      .query(
        `INSERT INTO events(session_id, event, tool_name, detail) VALUES(?, 'config_change', ?, ?)`,
      )
      .run(actor, what, detail);
    conn.close();
    log.info("db.audit.write", `actor=${actor} what=${what} old=${oldHash} new=${newHash}`);
  } catch (e) {
    log.fail("db.audit.write", e); // audit must not break the audited operation
  }
}

/** Latest config changes: events (config_change) merged with legacy kv chain-edit:*. */
export function getConfigAudit(limit = 20): AuditEntry[] {
  let conn: Database;
  try {
    conn = openPantheon();
  } catch (e) {
    throw e instanceof AppError
      ? e
      : new AppError(E.DB_OPEN, `config audit open: ${e instanceof Error ? e.message : e}`);
  }
  try {
    const evRows = conn
      .query(
        `SELECT id, coalesce(session_id, '') AS actor, coalesce(tool_name, '') AS what,
                coalesce(detail, '') AS detail, coalesce(created_at, '') AS created_at
         FROM events WHERE event = 'config_change'
         ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as { id: number; actor: string; what: string; detail: string; created_at: string }[];
    const kvRows = conn
      .query(
        `SELECT key, coalesce(value, '') AS value, coalesce(updated_at, '') AS updated_at
         FROM kv WHERE key LIKE 'chain-edit:%' ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit) as { key: string; value: string; updated_at: string }[];
    conn.close();

    const out: AuditEntry[] = [];
    for (const r of evRows) {
      let oldHash = "";
      let newHash = "";
      try {
        const d = JSON.parse(r.detail) as Record<string, unknown>;
        oldHash = typeof d.old_hash === "string" ? d.old_hash : "";
        newHash = typeof d.new_hash === "string" ? d.new_hash : "";
      } catch {
        // legacy plain-text detail — hash the payload itself
        newHash = shortHash(r.detail);
      }
      out.push({
        id: r.id,
        actor: r.actor,
        what: r.what,
        old_hash: oldHash,
        new_hash: newHash,
        created_at: r.created_at,
      });
    }
    for (const k of kvRows) {
      // legacy saveAgentChain writes: key chain-edit:<unix>, value "<role>: <chain json>"
      const ts = k.key.slice("chain-edit:".length);
      const fallbackAt = /^\d+$/.test(ts)
        ? new Date(Number(ts) * 1000).toISOString().slice(0, 19).replace("T", " ")
        : "";
      out.push({
        id: 0,
        actor: k.value.split(":")[0]?.trim() ?? "",
        what: "chain-edit",
        old_hash: "",
        new_hash: shortHash(k.value),
        created_at: k.updated_at || fallbackAt,
      });
    }
    out.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
    const res = out.slice(0, limit);
    log.info("db.audit.read", `limit=${limit} entries=${res.length}`);
    return res;
  } catch (e) {
    throw new AppError(E.DB_QUERY, `config audit: ${e instanceof Error ? e.message : e}`, {
      context: { limit },
    });
  }
}

// ── content_json → blocks (parity with content_blocks from db.rs) ──

export interface ContentBlock {
  kind: "text" | "thinking" | "tool" | "tool_out" | "image";
  text: string;
}

function clip(s: string, n: number): string {
  const t = s.trim();
  const chars = [...t];
  if (chars.length <= n) return t;
  let out = chars.slice(0, n).join("");
  const sp = out.lastIndexOf(" ");
  if (sp > 0 && n - 40 <= sp) out = out.slice(0, sp);
  return out + "…";
}

function isNoise(t: string): boolean {
  const head = t.trimStart();
  return (
    head.includes("<turn-context>") ||
    head.includes("</turn-context>") ||
    head.startsWith("Current tasks and notes:") ||
    (head.startsWith("Subagent ID:") && !head.includes("Задача") && !head.includes("СМОУК"))
  );
}

function stripNoise(t: string): string {
  if (isNoise(t)) return "";
  let s = t;
  if (s.startsWith("Subagent ID:")) {
    const nl = s.indexOf("\n");
    if (nl === -1) return "";
    s = s.slice(nl + 1).trimStart();
  }
  const start = s.indexOf("<turn-context>");
  if (start !== -1) {
    const before = s.slice(0, start).trim();
    const endRel = s.indexOf("</turn-context>", start);
    if (endRel !== -1) {
      const after = s.slice(endRel + "</turn-context>".length).trim();
      s = [before, after].filter(Boolean).join("\n");
    } else {
      s = before;
    }
  }
  return s.trim();
}

function summarizeToolOutput(t: string): string {
  const raw = t.trim();
  if (raw.startsWith("# Loaded Skill") || raw.startsWith("Loaded Skill")) {
    let name = "skill";
    for (const line of raw.split("\n")) {
      const l = line.trimStart().replace(/^#/, "").trim();
      if (l.startsWith("Loaded Skill")) {
        let rest = l.slice("Loaded Skill".length).trim();
        if (rest.startsWith(":")) rest = rest.slice(1).trim();
        const first = rest.split(/[\s(]/)[0] ?? "";
        const cleaned = first.replace(/[:(]/g, "").replace(/\)$/g, "").trim();
        if (cleaned) name = cleaned;
        break;
      }
    }
    return `⚙ загружен ${name}`;
  }
  if (raw.includes("<turn-context>") && raw.length > 80) {
    return "turn-context (скрыт)";
  }
  if ([...raw].length <= 200 && !raw.trimStart().startsWith("{")) {
    return clip(raw, 160);
  }
  const lines = raw.split("\n").filter((l) => l.trim() !== "").length;
  const bytes = raw.length;
  return `вывод · ${lines} строк · ${bytes} Б`;
}

export function contentBlocks(raw: string): ContentBlock[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // non-JSON content is normal for plain text, not an error
    log.debug("db.contentBlocks.nonjson", `len=${raw.length}`);
    const t = raw.trim();
    if (t === "" || isNoise(t)) return [];
    return [{ kind: "text", text: clip(t, 600) }];
  }

  const arr: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const out: ContentBlock[] = [];
  for (const b of arr) {
    if (typeof b !== "object" || b === null) continue;
    const obj = b as Record<string, unknown>;
    const type = typeof obj.type === "string" ? obj.type : null;
    if (type === "text") {
      const t = typeof obj.text === "string" ? obj.text : null;
      if (t === null) continue;
      const cleaned = stripNoise(t);
      if (cleaned === "") continue;
      out.push({ kind: "text", text: clip(cleaned, 12_000) });
    } else if (type === "thinking") {
      const t = typeof obj.thinking === "string" ? obj.thinking.trim() : "";
      if (t === "" || isNoise(t)) continue;
      out.push({ kind: "thinking", text: clip(t, 8_000) });
    } else if (type === "toolRequest" || type === "tool_use") {
      const toolCall = obj.toolCall as Record<string, unknown> | undefined;
      const value = toolCall?.value as Record<string, unknown> | undefined;
      const name =
        (typeof value?.name === "string" && value.name) ||
        (typeof obj.kind === "string" && obj.kind) ||
        (typeof obj.name === "string" && obj.name) ||
        (typeof obj.title === "string" && obj.title) ||
        "tool";
      const argsObj = value?.arguments as Record<string, unknown> | undefined;
      const detail = typeof argsObj?.name === "string" ? argsObj.name : null;
      out.push({ kind: "tool", text: detail !== null ? `${name} ${detail}` : name });
    } else if (type === "toolResponse" || type === "tool_result") {
      const toolResult = obj.toolResult as Record<string, unknown> | undefined;
      const content = toolResult?.value as Record<string, unknown> | undefined;
      const items = content?.content;
      let text: string | null = null;
      if (Array.isArray(items)) {
        for (const i of items) {
          if (typeof i === "object" && i !== null && typeof (i as any).text === "string") {
            text = (i as any).text as string;
            break;
          }
        }
      }
      out.push({ kind: "tool_out", text: text !== null ? summarizeToolOutput(text) : "результат" });
    } else if (type === "image") {
      out.push({ kind: "image", text: "изображение" });
    }
  }
  return out;
}

export interface SubagentMessage {
  role: string;
  content: string;
  blocks: ContentBlock[];
}

/** Last 80 subagent messages (DESC subquery → ASC outside), noise filtered */
export function listSubagentMessages(sessionId: string): SubagentMessage[] {
  const conn = openSessions();
  const rows = conn
    .query(
      `SELECT role, content_json FROM (
          SELECT id, role, content_json FROM messages
          WHERE session_id=? ORDER BY id DESC LIMIT 80
       ) ORDER BY id ASC`,
    )
    .all(sessionId) as { role: string; content_json: string }[];
  conn.close();

  const out: SubagentMessage[] = [];
  for (const r of rows) {
    const blocks = contentBlocks(r.content_json ?? "");
    if (blocks.length === 0) continue;
    out.push({
      role: r.role,
      content: blocks.map((b) => b.text).join("\n"),
      blocks,
    });
  }
  return out;
}

/** goose scheduler: ~/.local/share/goose/schedule.json */
export function getScheduledJobs(): unknown[] {
  const path = join(homedir(), ".local/share/goose/schedule.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

/** goose apps: *.html in ~/.local/share/goose/apps */
export function listStoredApps(): string[] {
  const dir = join(homedir(), ".local/share/goose/apps");
  const out: string[] = [];
  if (existsSync(dir)) {
    for (const e of readdirSync(dir)) {
      if (e.endsWith(".html")) out.push(e.slice(0, -".html".length));
    }
  }
  return out;
}

// ── Mayak panel (pantheon.rs → get_pantheon_overview) ──

export interface PantheonRun {
  session_id: string;
  role: string;
  status: string;
  model: string | null;
  started_at: string;
  task_summary: string | null;
}
export interface PantheonArtifact {
  path: string;
  kind: string;
  topic: string | null;
  created_at: string;
}
export interface RoleStat {
  role: string;
  runs: number;
  tokens: number | null;
  models: string[];
}
export interface PantheonOverview {
  runs: PantheonRun[];
  artifacts: PantheonArtifact[];
  role_stats: RoleStat[];
}

export function getPantheonOverview(): PantheonOverview {
  const conn = openPantheon();
  const runs = conn
    .query(
      `SELECT session_id, role, coalesce(status,''), model, coalesce(started_at,''), task_summary
       FROM runs ORDER BY started_at DESC LIMIT 20`,
    )
    .all() as PantheonRun[];
  const artifacts = conn
    .query(
      `SELECT path, kind, topic, coalesce(created_at,'') FROM artifacts
       ORDER BY created_at DESC LIMIT 40`,
    )
    .all() as PantheonArtifact[];
  const rawStats = conn
    .query(
      `SELECT role, COUNT(*) AS runs, GROUP_CONCAT(DISTINCT model) AS models
       FROM runs GROUP BY role ORDER BY COUNT(*) DESC`,
    )
    .all() as { role: string; runs: number; models: string | null }[];
  conn.close();

  // Weekly token spend per role comes from usage_ledger; null stays null (no data).
  let tokensByRole = new Map<string, number>();
  try {
    for (const u of getRoleUsage(7)) tokensByRole.set(u.role, u.total_tokens);
  } catch (e) {
    log.fail("db.overview.usage", e); // overview must stay usable without usage data
  }

  const role_stats: RoleStat[] = rawStats.map((s) => ({
    role: s.role,
    runs: s.runs,
    // runs has no usage columns — weekly spend comes from usage_ledger (null = no data)
    tokens: tokensByRole.get(s.role) ?? null,
    models: (s.models ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m !== ""),
  }));
  return { runs, artifacts, role_stats };
}

/** Recent artifacts (get_artifacts) */
export function getArtifacts(): { kind: string; path: string; topic: string; created_at: string }[] {
  const conn = openPantheon();
  const rows = conn
    .query(
      `SELECT kind, path, coalesce(topic,''), created_at FROM artifacts
       ORDER BY created_at DESC LIMIT 30`,
    )
    .all() as { kind: string; path: string; topic: string; created_at: string }[];
  conn.close();
  return rows;
}
