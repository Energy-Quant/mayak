/**
 * logger.ts — сквозное логирование Маяка (P12).
 *
 * Формат (единый для TS / Rust / Python / bash):
 *   2026-09-29T21:40:12.345Z | ERROR | acp.ts | 20260929_3 | session/load | sessionId=undefined fallback=loadId
 *   ─────────── timestamp ── | level | module | session_id | event | detail
 *
 * Правила:
 *  - НИ ОДНОГО catch {} без log.error — иначе точка отказа невидима.
 *  - module = имя файла без пути (автоматически из import.meta).
 *  - session_id = активная ACP-сессия или '-'.
 *  - Уровень: env MAYAK_LOG = debug | info | warn | error (default: info).
 *  - Ротация: mayak.log по 5 MB, старые ×3 (mayak.log.1 .. .3).
 *
 * Пункт приёма: по логу найти точку отказа ЛЮБОЙ транзакции.
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function envLevel(): number {
  const v = (process.env.MAYAK_LOG ?? "info").toLowerCase();
  return LEVELS[v as LogLevel] ?? LEVELS.info;
}

let threshold = envLevel();

/** Сменить уровень на лету (UI / тесты). */
export function setLogLevel(l: LogLevel): void {
  threshold = LEVELS[l];
}

/** Активная ACP-сессия — подставляется во все строки. */
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
  } catch {
    /* ротация не критична */
  }
}

/** Имя модуля = basename вызывающего файла. */
function moduleName(): string {
  try {
    const stack = new Error().stack ?? "";
    // строки вида: at fn (file:///home/.../api/db.ts:12:3)
    const lines = stack.split("\n");
    for (const line of lines.slice(3)) {
      const m = line.match(/(?:\(?file:\/\/)?(\/[^:)]+):\d+:\d+\)?/);
      if (m && !m[2].endsWith("logger.ts")) return basename(m[2]);
    }
  } catch {
    /* ignore */
  }
  return "logger";
}

function ts(): string {
  return new Date().toISOString();
}

/** Единая точка записи. */
function write(level: LogLevel, event: string, detail: string, mod?: string): void {
  if (LEVELS[level] < threshold) return;
  const line = `${ts()} | ${level.toUpperCase().padEnd(5)} | ${(mod ?? moduleName()).padEnd(22)} | ${(currentSession ?? "-").padEnd(12)} | ${event} | ${detail}\n`;
  try {
    const dir = logDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    rotate();
    appendFileSync(logPath(), line);
  } catch {
    /* диски тоже падают — но stderr виден в терминале */
  }
  // дублируем warn/error в stderr для dev
  if (LEVELS[level] >= LEVELS.warn) process.stderr.write(line);
}

export const log = {
  debug: (event: string, detail = "", mod?: string) => write("debug", event, detail, mod),
  info: (event: string, detail = "", mod?: string) => write("info", event, detail, mod),
  warn: (event: string, detail = "", mod?: string) => write("warn", event, detail, mod),
  error: (event: string, detail = "", mod?: string) => write("error", event, detail, mod),
  /** Старт транзакции — парная точка с log.end. */
  start: (event: string, detail = "", mod?: string) => write("info", `${event}.start`, detail, mod),
  /** Финал транзакции: ok=1/0. */
  end: (event: string, ok: boolean, detail = "", mod?: string) =>
    write(ok ? "info" : "error", `${event}.end`, `ok=${ok ? 1 : 0} ${detail}`.trim(), mod),
  /** Обёртка catch — ВСЕГДА логируем ошибку. */
  fail: (event: string, err: unknown, mod?: string) => {
    const e = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    write("error", event, e, mod);
  },
};

/** Для P3: лог + повторный бросок или fallback. */
export function logged<T>(event: string, fn: () => T, fallback: T, mod?: string): T {
  try {
    return fn();
  } catch (e) {
    log.fail(event, e, mod);
    return fallback;
  }
}

/** Для async P3. */
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

// ── старт модуля — видим, что логгер поднялся ──
write("info", "logger.ready", `file=${logPath()} level=${process.env.MAYAK_LOG ?? "info"}`, "logger.ts");
