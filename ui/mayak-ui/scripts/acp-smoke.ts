/**
 * scripts/acp-smoke.ts — приёмка шага 4: AcpSession против живого goose serve.
 * initialize + session/new + prompt → ответ агента. Запуск: bun scripts/acp-smoke.ts
 */
import { AcpSession, errText, type ChatMessage, type TodoItem } from "../src/acp";

const messages: ChatMessage[] = [];
let ready = false;
let error: string | null = null;
let todos: TodoItem[] = [];

const acp = new AcpSession({
  onMessage: (m) => {
    messages.push(m);
    if (m.role === "agent" && m.text.trim()) {
      // потоковый чанк — копим в последний agent-запись
      const last = [...messages].reverse().find((x) => x.role === "agent");
      void last;
    }
  },
  onUpdateMessage: () => {},
  onTodo: (items) => {
    todos = items;
  },
  onReady: () => {
    ready = true;
  },
  onError: (e) => {
    error = e;
  },
});

console.log("[1] start() — goose serve + WS + initialize + session/new …");
const t0 = Date.now();
try {
  const { mkdirSync } = await import("node:fs");
  mkdirSync("/tmp/mayak-acp-smoke", { recursive: true });
  await acp.start("/tmp/mayak-acp-smoke");
} catch (e) {
  console.error("❌ start FAILED:", errText(e));
  process.exit(1);
}
console.log(`✅ ready за ${Date.now() - t0}ms, sessionId=${acp.id}, status=${acp.status}`);
if (!ready || !acp.id) {
  console.error("❌ ready/sessionId отсутствует");
  process.exit(1);
}

console.log("[2] prompt() — «Ответь ровно одним словом: GO» …");
const t1 = Date.now();
try {
  await acp.prompt("Ответь ровно одним словом: GO. Ничего больше не пиши.");
} catch (e) {
  console.error("❌ prompt FAILED:", errText(e));
  acp.stop();
  process.exit(1);
}

// ждём ответ (чанки складываем в один текст)
let answer = "";
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  answer = messages
    .filter((m) => m.role === "agent")
    .map((m) => m.text)
    .join("");
  if (/GO/i.test(answer)) break;
  await new Promise((r) => setTimeout(r, 300));
}
const kinds = messages.reduce<Record<string, number>>((acc, m) => {
  acc[m.role] = (acc[m.role] ?? 0) + 1;
  return acc;
}, {});
console.log(`сообщений: ${messages.length} ${JSON.stringify(kinds)}`);
console.log(`ответ: ${JSON.stringify(answer.trim().slice(0, 200))}`);
console.log(`время prompt→ответ: ${Date.now() - t1}ms`);

acp.stop();
await new Promise((r) => setTimeout(r, 500));

const ok = /GO/i.test(answer) && acp.status === "idle";
if (ok) {
  console.log("✅ ACP-СМОУК ПРОЙДЕН: initialize + session/new + prompt работают из Bun");
  process.exit(0);
} else {
  console.error("❌ ACP-СМОУК УПАЛ", { error, status: acp.status });
  process.exit(1);
}
