// Контрактный тест ACP: goose serve (desktop) → @agentclientprotocol/sdk → initialize/session/new/session/prompt
// Запуск: node3 scripts/acp-contract-test.mjs (или node)
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import fs from "node:fs";
import { client, CLIENT_METHODS } from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";

const GOOSE = fs.existsSync("/opt/goose-desktop/resources/bin/goose")
  ? "/opt/goose-desktop/resources/bin/goose"
  : `${os.homedir()}/.local/bin/goose`;
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
  s.on("error", rej);
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const port = await freePort();
const secret = "sk-pantheon-contract-test";
const cwd = fs.mkdtempSync("/tmp/acp-test-");
console.log(`[1] spawn: ${GOOSE} serve --port ${port} (cwd ${cwd})`);
const child = spawn(GOOSE, ["serve", "--platform", "desktop", "--host", "127.0.0.1", "--port", String(port)],
  { cwd, env: { ...process.env, GOOSE_SERVER__SECRET_KEY: secret, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", d => process.stdout.write("  [serve] " + d));
child.stderr.on("data", d => process.stdout.write("  [serve:err] " + d));
child.on("exit", c => console.log(`[serve] exit ${c}`));

let up = false;
for (let i = 0; i < 50 && !up; i++) {
  up = await fetch(`http://127.0.0.1:${port}/health`, { method: "GET" }).then(r => r.ok).catch(() => false);
  if (!up) {
    try { const r = await fetch(`http://127.0.0.1:${port}/`); up = r.status < 500; } catch {}
  }
  if (!up) await sleep(500);
}
if (!up) { console.error("FAIL: serve не поднялся за 25с"); process.exit(1); }
console.log("[2] serve поднят (25с-окно уложено)");

const ws_url = `ws://127.0.0.1:${port}/acp?token=${secret}`;
console.log(`[3] ws connect: ${ws_url}`);
const stream = createWebSocketStream(ws_url, { protocols: [] });

const updates = [];
const app = client({ name: "contract-test" })
  .onRequest(CLIENT_METHODS.session_request_permission, async () => ({
    outcome: { outcome: "selected", optionId: "allow_once" },
  }))
  .onNotification(CLIENT_METHODS.session_update, (ctx) => {
    updates.push(ctx.params);
  });
const conn = app.connect(stream);

const init = await conn.agent.request("initialize", {
  protocolVersion: 1,
  clientCapabilities: {},
  clientInfo: { name: "contract-test", version: "0.1.0" },
});
console.log(`[4] initialize OK: protocolVersion=${init.protocolVersion} agent=${JSON.stringify(init.agentInfo)}`);

const created = await conn.agent.request("session/new", { cwd, mcpServers: [] });
console.log(`[5] session/new OK: ${created.sessionId}`);

const PROMPT = "Ответь ровно одним словом: GO. Ничего больше не пиши.";
const timer = setTimeout(() => { console.error("FAIL: prompt не ответил за 120с"); finish(1); }, 120000);
let answer = "";
let sawUpdate = false;

function finish(code) {
  clearTimeout(timer);
  console.log(`\n=== ИТОГ ===`);
  console.log(`updates получено: ${updates.length}`);
  const kinds = {};
  for (const u of updates) { const k = (u.update?.sessionUpdate) ?? "unknown"; kinds[k] = (kinds[k] ?? 0) + 1; }
  console.log(`виды updates: ${JSON.stringify(kinds)}`);
  console.log(`ответ агента: ${JSON.stringify(answer.trim().slice(0, 200))}`);
  const contract = init?.protocolVersion && created?.sessionId && sawUpdate && /GO/.test(answer.trim());
  console.log(contract ? "✅ КОНТРАКТ ПРОЙДЕН" : "❌ КОНТРАКТ УПАЛ");
  child.kill("SIGTERM");
  process.exit(code);
}

try {
  await conn.agent.request("session/prompt", { sessionId: created.sessionId, prompt: [{ type: "text", text: PROMPT }] });
  // обновления бетчами приходят во время запроса; после возврата дадим 1с на хвост
  await sleep(1000);
  for (const u of updates) {
    const up = u.update ?? u;
    if (up.sessionUpdate === "agent_message_chunk") {
      sawUpdate = true;
      answer += up.content?.text ?? "";
    }
  }
  finish(sawUpdate ? 0 : 1);
} catch (e) {
  console.error("FAIL prompt:", e?.message ?? e);
  finish(1);
}
