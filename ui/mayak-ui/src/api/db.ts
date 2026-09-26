/**
 * api/db.ts — порт db.rs (+ панель из pantheon.rs) на bun:sqlite.
 * Форматы ответов БАЙТ-В-БАЙТ как у Tauri-команд (компоненты не переписываем).
 * pantheon.db — read-write только для kv-аудита; sessions.db — строго readonly.
 */
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";

export const pantheonDbPath = () => join(homedir(), ".local/share/goose/pantheon.db");
const sessionsDbPath = () => join(homedir(), ".local/share/goose/sessions/sessions.db");

/** CREATE TABLE IF NOT EXISTS (runs, kv) + открытие — как open() в db.rs */
export function openPantheon(): Database {
  const path = pantheonDbPath();
  mkdirSync(join(path, ".."), { recursive: true });
  const conn = new Database(path);
  conn.run(`CREATE TABLE IF NOT EXISTS runs (
      session_id TEXT PRIMARY KEY, parent_session_id TEXT,
      role TEXT NOT NULL DEFAULT 'adhoc', status TEXT DEFAULT 'running',
      task_summary TEXT, model TEXT,
      started_at TEXT DEFAULT (datetime('now')), finished_at TEXT);`);
  conn.run(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT,
      updated_at TEXT DEFAULT (datetime('now')));`);
  return conn;
}

function openSessions(): Database {
  return new Database(sessionsDbPath(), { readonly: true });
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
 * Дети сессии (sub_agent) — прямой запрос по parent_session_id.
 * НЕ через listSessions: тот режет LIMIT 100 по updated_at и теряет детей
 * старых сессий (родитель в топ-100, дети — уже нет).
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
  } catch {
    /* pantheon.db может не существовать */
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

/** История сессий (sessions.db readonly) + running-флаг из pantheon.db */
export function listSessions(onlyRunning = false): SessionRow[] {
  let running = new Set<string>();
  try {
    const conn = openPantheon();
    const rs = conn
      .query("SELECT session_id FROM runs WHERE status='running'")
      .all() as { session_id: string }[];
    running = new Set(rs.map((r) => r.session_id));
    conn.close();
  } catch {
    /* pantheon.db может не существовать — running пуст */
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
  } catch {
    /* аудит не должен ронять операцию */
  }
}

// ── content_json → блоки (паритет content_blocks из db.rs) ──

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

/** Последние 80 сообщений субагента (DESC-подзапрос → ASC наружу), шум отфильтрован */
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

/** Планировщик goose: ~/.local/share/goose/schedule.json */
export function getScheduledJobs(): unknown[] {
  const path = join(homedir(), ".local/share/goose/schedule.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Приложения goose: *.html в ~/.local/share/goose/apps */
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

// ── Панель Маяка (pantheon.rs → get_pantheon_overview) ──

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
      `SELECT role, COUNT(*), GROUP_CONCAT(DISTINCT model)
       FROM runs GROUP BY role ORDER BY COUNT(*) DESC`,
    )
    .all() as { role: string; runs: number; models: string | null }[];
  conn.close();

  const role_stats: RoleStat[] = rawStats.map((s) => ({
    role: s.role,
    runs: s.runs,
    tokens: null, // в runs нет usage-колонок (schema.sql)
    models: (s.models ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m !== ""),
  }));
  return { runs, artifacts, role_stats };
}

/** Последние артефакты (get_artifacts) */
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
