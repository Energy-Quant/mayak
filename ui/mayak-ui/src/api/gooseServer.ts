/**
 * api/gooseServer.ts — порт goose_server.rs: спавн `goose serve` + readiness.
 * Origin: GPUIX desktop шлёт WS без Origin (или null/file) — base-список
 * --allowed-origin оставляем (exact-list ЗАМЕНЯЕТ loopback-дефолт goose).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, openSync } from "node:fs";
import net from "node:net";
import type { Subprocess } from "bun";

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
    return false;
  }
}

/** Origins exact-list (хотя бы один --allowed-origin ВЫКЛЮЧАЕТ loopback-дефолт) */
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
  throw new Error("goose binary не найден ни в /opt/goose-desktop, ни ~/.local/bin");
}

export async function start(dir?: string, origins?: string[]): Promise<ServeInfo> {
  // живой здоровый sidecar — переиспользуем (retry без спавна зомби)
  if (info) {
    const alive = child !== null && child.exitCode === null && child.signalCode === null;
    if (alive && (await statusOk(info.port))) return info;
    if (child) {
      try {
        child.kill();
      } catch {
        /* уже мёртв */
      }
    }
    child = null;
    info = null;
    secret = "";
  }

  const home = homedir();
  const goosePath = gooseBinary();
  const workingDir = dir ?? home;
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
      return info;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  // readiness не дождались — убить, чтобы не копить зомби
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  child = null;
  throw new Error("goose serve не поднялся за 25с");
}

export async function stop(): Promise<void> {
  if (child) {
    try {
      child.kill();
      await child.exited;
    } catch {
      /* ignore */
    }
  }
  child = null;
  info = null;
  secret = "";
}
