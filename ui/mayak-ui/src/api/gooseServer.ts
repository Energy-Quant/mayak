/**
 * api/gooseServer.ts — port of goose_server.rs: spawn `goose serve` + readiness.
 * Origin: the GPUIX desktop sends WS without Origin (or null/file) — keep the base
 * --allowed-origin list (the exact list REPLACES goose's loopback default).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, openSync } from "node:fs";
import net from "node:net";
import type { Subprocess } from "bun";
import { log } from "../logger";
import { AppError, E } from "../errors";

export interface ServeInfo {
  port: number;
  http_base: string;
  ws_url: string;
  pid: number;
}

let child: Subprocess | null = null;
let info: ServeInfo | null = null;
let secret = "";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

async function statusOk(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.status === 200;
  } catch {
    // statusOk: the sidecar is not listening yet — expected while polling readiness
    return false;
  }
}

/**
 * P2 watchdog: health check for goose serve.
 * Returns ok when the process is alive and /status answers 200.
 */
export async function healthCheck(): Promise<{ ok: boolean; reason?: string }> {
  if (!info) return { ok: false, reason: "не запущен" };
  const alive = child !== null && child.exitCode === null && child.signalCode === null;
  if (!alive) return { ok: false, reason: "процесс завершился" };
  const ok = await statusOk(info.port);
  return ok ? { ok: true } : { ok: false, reason: `/status не отвечает на порту ${info.port}` };
}

/** Last known sidecar info (for the UI indicator). */
export function currentInfo(): ServeInfo | null {
  return info;
}

/** Origins exact-list (any --allowed-origin DISABLES the loopback default) */
function baseOrigins(): string[] {
  return [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "null",
    "file://",
    "http://localhost",
    "http://127.0.0.1",
  ];
}

function gooseBinary(): string {
  const candidates = [
    "/opt/goose-desktop/resources/bin/goose",
    join(homedir(), ".local/bin/goose"),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  throw new AppError(E.GOOSE_BINARY, "goose binary not found in /opt/goose-desktop or ~/.local/bin");
}

/**
 * Serialize spawn/kill: concurrent ACP starts (UI retry vs watchdog reconnect)
 * must not race two Bun.spawn calls — that leaks a zombie sidecar.
 */
let opTail: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = opTail.then(fn, fn);
  opTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function start(dir?: string, origins?: string[]): Promise<ServeInfo> {
  return serialize(() => startLocked(dir, origins));
}

async function startLocked(dir?: string, origins?: string[]): Promise<ServeInfo> {
  log.start("gooseServer.start", `dir=${dir ?? "default"} origins=${(origins ?? baseOrigins()).length}`);
  // alive and healthy sidecar — reuse it (retries without spawning a zombie)
  if (info) {
    const alive = child !== null && child.exitCode === null && child.signalCode === null;
    if (alive && (await statusOk(info.port))) return info;
    if (child) {
      try {
        child.kill();
      } catch (e) {
        log.debug("gooseServer.reuse.kill", String(e));
      }
    }
    child = null;
    info = null;
    secret = "";
  }

  const home = homedir();
  const goosePath = gooseBinary();
  const workingDir = dir ?? home;
  if (!existsSync(workingDir)) mkdirSync(workingDir, { recursive: true }); // spawn fails with ENOENT on a non-existent cwd
  const port = await freePort();
  secret = `sk-mayak-${Date.now().toString(16)}517cc1b7`;

  const logDir = join(home, ".local/state/mayak-ui");
  mkdirSync(logDir, { recursive: true });
  const logFd = openSync(join(logDir, "goose-serve.log"), "a");

  const allowed = baseOrigins();
  for (const o of origins ?? []) {
    const t = o.trim();
    if (t !== "" && !allowed.includes(t)) allowed.push(t);
  }

  const args = [
    "serve",
    "--platform",
    "desktop",
    "--enable-scheduler",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ];
  for (const o of allowed) {
    args.push("--allowed-origin", o);
  }

  child = Bun.spawn([goosePath, ...args], {
    env: {
      ...process.env,
      GOOSE_SERVER__SECRET_KEY: secret,
      NO_COLOR: "1",
    },
    cwd: workingDir,
    stdout: "ignore",
    stderr: logFd, // fd → ~/.local/state/mayak-ui/goose-serve.log (append)
  });

  for (let i = 0; i < 50; i++) {
    if (await statusOk(port)) {
      info = {
        port,
        http_base: `http://127.0.0.1:${port}`,
        ws_url: `ws://127.0.0.1:${port}/acp?token=${secret}`,
        pid: child.pid,
      };
      log.end("gooseServer.start", true, `port=${port} pid=${child.pid}`);
      return info;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  // readiness never came — kill it so zombies do not accumulate
  try {
    child.kill();
  } catch (e) {
    log.debug("gooseServer.kill-after-timeout", String(e));
  }
  child = null;
  log.end("gooseServer.start", false, "readiness timeout 25s");
  throw new AppError(E.GOOSE_STARTUP, "goose serve failed to become ready within the 25s timeout", { recoverable: true });
}

export function stop(): Promise<void> {
  return serialize(() => stopLocked());
}

async function stopLocked(): Promise<void> {
  log.start("gooseServer.stop", `pid=${child?.pid ?? "-"}`);
  if (child) {
    try {
      child.kill();
      await child.exited;
      log.end("gooseServer.stop", true);
    } catch (e) {
      log.fail("gooseServer.stop", e);
    }
  }
  child = null;
  info = null;
  secret = "";
}
