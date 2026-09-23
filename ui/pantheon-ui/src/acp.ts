// acp.ts — подключение к goose serve по схеме desktop: ws → @agentclientprotocol/sdk
import { client, CLIENT_METHODS } from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import { invoke } from "@tauri-apps/api/core";

// Gate: вне Tauri (браузер/dev) invoke гарантированно не работает
export const isTauri = (): boolean =>
  typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
export const safeInvoke = <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  // строгая проверка: сам invoke внутри читает window.__TAURI_INTERNALS__.invoke и крашится с
  // TypeError «reading 'invoke'», если IPC-инъекция умерла (например, после падения WebProcess)
  const internals = (window as any).__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== "function") {
    return Promise.reject(new Error("Tauri IPC недоступен — перезапустите окно (инъекция потеряна)"));
  }
  return invoke<T>(cmd, args);
};

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "tool";
  text: string;
  toolName?: string;
  toolStatus?: "pending" | "in_progress" | "completed" | "failed";
  subagentSessionId?: string;
  /** создан из agent_message_chunk — следующие чанки дописываем в него, а не плодим сообщения */
  chunk?: boolean;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

/** Чистим строку TODO от служебных символов: «1. », «- [x] », «✅», «— ВЫПОЛНЕНО», кавычки-хвосты */
export function cleanTodoText(raw: string): string {
  let t = raw.replace(/\\n/g, " ").replace(/[`*_]/g, "").trim();
  t = t.replace(/^\s*\d+[.)]\s+/, "");                 // 1. → 
  t = t.replace(/^\s*[-*•]\s+/, "");                   // - → 
  t = t.replace(/^\[([ xX✓✔])\]\s*/, "");              // [x] → 
  t = t.replace(/\s*(✅|☑|✔|—\s*ВЫПОЛНЕНО\s*—?)/gi, "");
  t = t.replace(/\s*—\s*(выполнено|в процессе)\s*$/i, "");
  return t.replace(/\s{2,}/g, " ").trim();
}

/**
 * TODO приходит НЕ апдейтом plan/todos, а вызовом инструмента `todo write`
 * с content=markdown-список (1. ... / - [x] ... / ✅ в конце строки).
 * Распознаём оба формата — иначе правая панель с галочками пустая.
 */
export function parseTodos(content: unknown): TodoItem[] {
  if (typeof content !== "string") return [];
  const out: TodoItem[] = [];
  const text = content.replace(/\\n/g, "\n");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue; // заголовок списка — не пункт
    const cb = trimmed.match(/^(?:[-*•]\s*)?\[([ xX✓✔~])\]\s*(.*)$/);
    const num = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (cb) {
      const done = cb[1].toLowerCase() !== " " && cb[1] !== "~";
      const progress = cb[1] === "~";
      out.push({ content: cleanTodoText(cb[2]), status: progress ? "in_progress" : done ? "completed" : "pending" });
    } else if (num) {
      let status: TodoItem["status"] = "pending";
      let t = num[1];
      if (/(✅|☑|✔|\[x\])/i.test(t)) status = "completed";
      else if (/(⏳|\[~\]|в процессе|in.progress)/i.test(t)) status = "in_progress";
      const cleaned = cleanTodoText(t);
      if (cleaned) out.push({ content: cleaned, status });
    }
  }
  return out.filter((x) => x.content.length > 0);
}

export type AcpStatus = "idle" | "starting" | "ready" | "error";

type Handlers = {
  onMessage: (m: ChatMessage) => void;
  onUpdateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  onTodo: (items: TodoItem[]) => void;
  onReady: () => void;
  onError: (e: string) => void;
};

type AnyConn = { agent: { request(m: string, p: any): Promise<any>; notify(m: string, p: any): void } };

export class AcpSession {
  private connection: AnyConn | null = null;
  private sessionId: string | null = null;
  private handlers: Handlers;
  status: AcpStatus = "idle";

  constructor(h: Handlers) {
    this.handlers = h;
  }

  /** id текущей ACP-сессии — родитель для иерархии субагентов */
  get id(): string | null { return this.sessionId; }

  async start(workingDir?: string) {
    this.status = "starting";
    const serve = await safeInvoke<{ ws_url: string }>("start_goose_server", { dir: workingDir });
    const stream = createWebSocketStream(serve.ws_url, { protocols: [] } as never);

    const app = client({ name: "pantheon-ui" })
      .onRequest(CLIENT_METHODS.session_request_permission, async (): Promise<any> => ({
        outcome: { outcome: "selected", optionId: "allow_once" },
      }))
      .onNotification(CLIENT_METHODS.session_update, async (ctx: { params: Record<string, unknown> }) => {
        this.handleSessionUpdate(ctx.params);
      });
    this.connection = app.connect(stream) as unknown as AnyConn;

    await this.connection.agent.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "pantheon-ui", version: "0.1.0" },
    });

    const created = (await this.connection.agent.request("session/new", {
      cwd: workingDir ?? "/home/quant",
      mcpServers: [],
    } as never)) as { sessionId: string };
    this.sessionId = created.sessionId;
    this.status = "ready";
    this.handlers.onReady();
  }

  async prompt(text: string) {
    if (!this.sessionId) throw new Error("сессия не открыта");
    this.handlers.onMessage({ id: crypto.randomUUID(), role: "user", text });
    await this.connection!.agent.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  async cancel() {
    if (this.sessionId) this.connection!.agent.notify("session/cancel", { sessionId: this.sessionId });
  }

  stop() {
    safeInvoke("stop_goose_server").catch(() => {});
    this.status = "idle";
    this.sessionId = null;
    this.connection = null;
  }

  private handleSessionUpdate(u: Record<string, any>) {
    const up = u.update ?? u;
    const kind: string = up.sessionUpdate ?? "";
    const id: string = up.sessionId ?? up.toolCallId ?? crypto.randomUUID();

    switch (kind) {
      case "agent_message_chunk": {
        const text = typeof up.content === "object" && up.content ? String(up.content.text ?? "") : String(up.content ?? "");
        this.handlers.onMessage({ id, role: "agent", text });
        break;
      }
      case "user_message_chunk":
        break;
      case "tool_call": {
        const meta = (up._meta ?? {}) as { subagent_session_id?: string };
        const toolName = String(up.title ?? up.kind ?? "tool");
        const rawIn = up.rawInput;
        // todo write → парсим контент в чек-лист правой панели (нативные галочки)
        if (/todo/i.test(toolName) && rawIn && typeof rawIn === "object") {
          const items = parseTodos((rawIn as { content?: unknown }).content ?? (rawIn as { text?: unknown }).text);
          if (items.length) this.handlers.onTodo(items);
        }
        this.handlers.onMessage({
          id: String(up.toolCallId ?? id), role: "tool",
          text: typeof rawIn === "string" ? rawIn : JSON.stringify(rawIn ?? ""),
          toolName,
          toolStatus: up.status as ChatMessage["toolStatus"],
          subagentSessionId: meta?.subagent_session_id,
        });
        break;
      }
      case "tool_call_update": {
        const patch: Partial<ChatMessage> = { toolStatus: up.status as ChatMessage["toolStatus"] };
        let text: string | undefined;
        const body = up.rawOutput?.content?.[0];
        if (typeof body === "object" && body && body.text !== undefined) text = String(body.text ?? "");
        else if (typeof up.rawOutput === "string") text = up.rawOutput;
        // todo write возвращает обновлённый список в rawOutput — перепарсим (галочки ✅/—)
        if (/todo/i.test(String((up as any).title ?? (up as any).kind ?? "")) && text) {
          const items = parseTodos(text);
          if (items.length) this.handlers.onTodo(items);
        }
        // текст даём только когда он реально есть: spread с text:undefined ЗАТИРАЛ
        // уже отрендеренный текст → «undefined is not an object (m.text.slice)» и крах рендера
        if (text !== undefined) patch.text = text;
        this.handlers.onUpdateMessage(String(up.toolCallId ?? ""), patch);
        break;
      }
      default: {
        const entries = up.plan?.entries ?? up.todos ?? (up as any).todos;
        if (Array.isArray(entries)) {
          // plan-entries приезжают с «сырыми» строками («1. …», «# Заголовок», ✅) — чистим
          this.handlers.onTodo(
            entries
              .map((e: Record<string, any>) => ({
                content: cleanTodoText(String(e.text ?? e.content ?? e.task ?? "")),
                status: (e.status as TodoItem["status"]) ?? "pending",
              }))
              .filter((x) => x.content.length > 0),
          );
        }
      }
    }
  }
}

export interface SubagentRow { id: string; label: string; tokens: number; running: boolean }
/** Субагенты ИЕРАРХИЧЕСКИ: только дети parentId. Без parentId — пусто (иерархия, не плоский список). */
export const listSubagents = async (parentId?: string | null): Promise<SubagentRow[]> => {
  if (!parentId) return [];
  const rows = await safeInvoke<any[]>("list_sessions", { onlyRunning: false });
  return rows
    .filter((r: any) => r.session_type === "sub_agent" && r.parent_session_id === parentId)
    .slice(0, 12)
    .map((r: any) => ({
      id: r.id, label: r.title || "Субагент", tokens: r.total_tokens ?? 0,
      running: !!r.running,
    }));
};
