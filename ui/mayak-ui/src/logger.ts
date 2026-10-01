/**
 * logger.ts — end-to-end logging for Mayak (P12).
 *
 * Format (shared by TS / Rust / Python / bash):
 *   2026-09-29T21:40:12.345Z | ERROR | acp.ts | 20260929_3 | session/load | sessionId=undefined fallback=loadId
 *   ─────────── timestamp ── | level | module | session_id | event | detail
 *
 * Rules:
 *  - NO catch {} without a log entry — otherwise the failure point is invisible.
 *  - module = file name without path (derived from import.meta).
 *  - session_id = active ACP session or '-'.
 *  - Level: env MAYAK_LOG = debug | info | warn | error (default: info).
 *  - Rotation: mayak.log at 5 MB, 3 old files kept (mayak.log.1 .. .3).
 *
 * Acceptance criterion: any transaction's failure point must be findable from the log.
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function envLevel(): number {
  const v = (process.env.MAYAK_LOG ?? "info").toLowerCase();
  return LEVELS[v as LogLevel] ?? LEVELS.info;
}

let threshold = envLevel();

/** Change the level at runtime (UI / tests). */
export function setLogLevel(l: LogLevel): void {
  threshold = LEVELS[l];
}

/** Active ACP session — substituted into every line. */
let currentSession: string | null = null;
export function setLogSession(id: string | null): void {
  currentSession = id;
}
export function getLogSession(): string | null {
  return currentSession;
}

function logDir(): string {
  return join(homedir(), ".local/state/mayak-ui");
}
function logPath(): string {
  return join(logDir(), "mayak.log");
}

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

function rotate(): void {
  try {
    const p = logPath();
    if (!existsSync(p)) return;
    if (statSync(p).size < MAX_BYTES) return;
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = `${p}.${i}`;
      const to = `${p}.${i + 1}`;
      if (existsSync(from)) renameSync(from, to);
    }
    renameSync(p, `${p}.1`);
  } catch (e) {
    // rotation is non-fatal, but silent loss of old logs would hide failure history — surface on stderr
    process.stderr.write(`${ts()} | WARN  | logger    | -           | logger.rotate | ${String(e)}\n`);
  }
}

/** Module name = basename of the calling file. */
function moduleName(): string {
  try {
    const stack = new Error().stack ?? "";
    // lines like: at fn (file:///home/.../api/db.ts:12:3)
    const lines = stack.split("\n");
    for (const line of lines.slice(3)) {
      const m = line.match(/(?:\(?file:\/\/)?(\/[^:)]+):\d+:\d+\)?/);
      if (m && !m[2].endsWith("logger.ts")) return basename(m[2]);
    }
  } catch {
    /* best-effort: stack parsing may fail — fall back to the logger's own module name */
  }
  return "logger";
}

function ts(): string {
  return new Date().toISOString();
}

/** Single write path. */
function write(level: LogLevel, event: string, detail: string, mod?: string): void {
  if (LEVELS[level] < threshold) return;
  const line = `${ts()} | ${level.toUpperCase().padEnd(5)} | ${(mod ?? moduleName()).padEnd(22)} | ${(currentSession ?? "-").padEnd(12)} | ${event} | ${detail}\n`;
  try {
    const dir = logDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    rotate();
    appendFileSync(logPath(), line);
  } catch (e) {
    // disk failures happen — the file line is lost; warn/error still reach stderr below
    process.stderr.write(`${ts()} | WARN  | logger    | -           | logger.write | ${String(e)}\n`);
  }
  // mirror warn/error to stderr for dev
  if (LEVELS[level] >= LEVELS.warn) process.stderr.write(line);
}

export const log = {
  debug: (event: string, detail = "", mod?: string) => write("debug", event, detail, mod),
  info: (event: string, detail = "", mod?: string) => write("info", event, detail, mod),
  warn: (event: string, detail = "", mod?: string) => write("warn", event, detail, mod),
  error: (event: string, detail = "", mod?: string) => write("error", event, detail, mod),
  /** Transaction start — pairs with log.end. */
  start: (event: string, detail = "", mod?: string) => write("info", `${event}.start`, detail, mod),
  /** Transaction end: ok=1/0. */
  end: (event: string, ok: boolean, detail = "", mod?: string) =>
    write(ok ? "info" : "error", `${event}.end`, `ok=${ok ? 1 : 0} ${detail}`.trim(), mod),
  /** catch wrapper — ALWAYS logs the error. */
  fail: (event: string, err: unknown, mod?: string) => {
    const e = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    write("error", event, e, mod);
  },
};

/** For P3: log + rethrow or fallback. */
export function logged<T>(event: string, fn: () => T, fallback: T, mod?: string): T {
  try {
    return fn();
  } catch (e) {
    log.fail(event, e, mod);
    return fallback;
  }
}

/** Async variant for P3. */
export async function loggedAsync<T>(
  event: string,
  fn: () => Promise<T>,
  fallback: T,
  mod?: string,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    log.fail(event, e, mod);
    return fallback;
  }
}

// ── module start — shows that the logger came up ──
write("info", "logger.ready", `file=${logPath()} level=${process.env.MAYAK_LOG ?? "info"}`, "logger.ts");
