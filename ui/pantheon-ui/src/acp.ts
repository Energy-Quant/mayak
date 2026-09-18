// acp.ts — подключение к goose serve по схеме desktop: ws → @agentclientprotocol/sdk
import { client, CLIENT_METHODS } from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import { invoke } from "@tauri-apps/api/core";

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "tool";
  text: string;
  toolName?: string;
  toolStatus?: "pending" | "in_progress" | "completed" | "failed";
  subagentSessionId?: string;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
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

  async start(workingDir?: string) {
    this.status = "starting";
    const serve = await invoke<{ ws_url: string }>("start_goose_server", { dir: workingDir });
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
    invoke("stop_goose_server").catch(() => {});
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
        this.handlers.onMessage({
          id: String(up.toolCallId ?? id), role: "tool",
          text: typeof up.rawInput === "string" ? up.rawInput : JSON.stringify(up.rawInput ?? ""),
          toolName: String(up.title ?? up.kind ?? "tool"),
          toolStatus: up.status as ChatMessage["toolStatus"],
          subagentSessionId: meta?.subagent_session_id,
        });
        break;
      }
      case "tool_call_update": {
        let text: string | undefined;
        const body = up.rawOutput?.content?.[0];
        if (typeof body === "object" && body) text = String(body.text ?? "");
        else if (typeof up.rawOutput === "string") text = up.rawOutput;
        this.handlers.onUpdateMessage(String(up.toolCallId ?? ""), { toolStatus: up.status as ChatMessage["toolStatus"], text });
        break;
      }
      default: {
        const entries = up.plan?.entries ?? up.todos ?? (up as any).todos;
        if (Array.isArray(entries)) {
          this.handlers.onTodo(entries.map((e: Record<string, any>) => ({
            content: String(e.text ?? e.content ?? e.task ?? ""),
            status: e.status as TodoItem["status"],
          })));
        }
      }
    }
  }
}

export interface SubagentRow { id: string; label: string; tokens: number; running: boolean }
export const listSubagents = async (): Promise<SubagentRow[]> => {
  const rows = await invoke<any[]>("list_sessions", { onlyRunning: false });
  return rows
    .filter((r: any) => r.session_type === "sub_agent")
    .slice(0, 12)
    .map((r: any) => ({
      id: r.id, label: r.title || "Субагент", tokens: r.total_tokens ?? 0,
      running: !!r.running,
    }));
};
