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

/** Вложение чата: картинка уходит ACP image-блоком; документ staged-ится в tmp и идёт путём в тексте */
export interface Attachment {
  id: string;
  name: string;
  /** для превью (data URL) — только картинки */
  dataUrl?: string;
  /** base64 без префикса — для ACP image */
  data?: string;
  mimeType?: string;
  /** staged путь — документы (как drop в оригинальном Goose) */
  path?: string;
  kind: "image" | "file";
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "tool";
  text: string;
  toolName?: string;
  toolStatus?: "pending" | "in_progress" | "completed" | "failed";
  subagentSessionId?: string;
  /** создан из agent_message_chunk — следующие чанки дописываем в него, а не плодим сообщения */
  chunk?: boolean;
  /** сырой JSON входа инструмента — сохраняется отдельно, чтобы tool_call_update не затирал */
  toolInput?: string;
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

/**
 * Ошибки WebSocket в браузере приезжают Event'ом → String(e) = «[object Event]».
 * Разбираем в читаемый текст (type/code/message/error).
 */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (e && typeof e === "object") {
    const any = e as Record<string, unknown>;
    const bits: string[] = [];
    if (typeof any.message === "string" && any.message) bits.push(any.message);
    else if (typeof any.reason === "string" && any.reason) bits.push(any.reason);
    if (typeof any.type === "string" && any.type) bits.push(`event=${any.type}`);
    if (typeof any.code === "number") bits.push(`code=${any.code}`);
    if (typeof any.error === "string" && any.error) bits.push(any.error);
    if (bits.length) return bits.join(" · ");
    const tag = (e as { constructor?: { name?: string } })?.constructor?.name;
    if (tag && tag !== "Object") return tag;
  }
  const s = String(e);
  return s === "[object Event]" ? "WebSocket: соединение отклонено" : s;
}

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
  /** реестр путей staged-изображений сессии — пробрасываем субагентам через delegate context */
  private sessionImagePaths: string[] = [];

  constructor(h: Handlers) {
    this.handlers = h;
  }

  /** id текущей ACP-сессии — родитель для иерархии субагентов */
  get id(): string | null { return this.sessionId; }

  async start(workingDir?: string, loadId?: string) {
    this.status = "starting";
    // window.location.origin: dev = http://localhost:1420 (с портом!),
    // release = tauri://localhost — goose сравнивает exact, порт обязателен
    const origins = Array.from(
      new Set(
        [
          typeof location !== "undefined" ? location.origin : "",
          "tauri://localhost",
          "http://tauri.localhost",
          "https://tauri.localhost",
          "null",
        ].filter(Boolean),
      ),
    );
    const serve = await safeInvoke<{ ws_url: string }>("start_goose_server", {
      dir: workingDir,
      origins,
    });
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

    const cwd = workingDir ?? "/home/quant";
    if (loadId) {
      // открытие существующей сессии: история replay'ится через session/update
      const loaded = (await this.connection.agent.request("session/load", {
        sessionId: loadId,
        cwd,
        mcpServers: [],
      } as never)) as { sessionId: string };
      this.sessionId = loaded.sessionId;
    } else {
      const created = (await this.connection.agent.request("session/new", {
        cwd,
        mcpServers: [],
      } as never)) as { sessionId: string };
      this.sessionId = created.sessionId;
    }
    this.status = "ready";
    this.handlers.onReady();
  }

  /** Открыть существующую сессию (session/load): goose сам replay'ит историю */
  async load(sessionId: string, workingDir?: string) {
    if (this.connection) {
      this.stop();
    }
    await this.start(workingDir, sessionId);
  }

  /**
   * session/prompt: текст + image-блоки (Ctrl+V) + staged-пути документов.
   * Паритет с оригинальным Goose: картинки → ACP image, файлы → путь в тексте.
   */
  async prompt(
    text: string,
    images?: { data: string; mimeType: string }[],
    filePaths?: string[],
  ) {
    if (!this.sessionId) throw new Error("сессия не открыта");
    let body = text;
    // регистрируем пути для контекста субагентов
    if (filePaths?.length) {
      for (const p of filePaths) {
        if (!this.sessionImagePaths.includes(p)) this.sessionImagePaths.push(p);
      }
      const paths = filePaths.join(" ");
      body = body ? `${body}\n${paths}` : paths;
    }
    // [imgs] — машиночитаемый блок путей: system.md требует прокидывать их в delegate context
    if (this.sessionImagePaths.length > 0) {
      body += `\n\n[imgs] ${this.sessionImagePaths.join(" ")}`;
    }
    const blocks: Record<string, unknown>[] = [];
    if (body) blocks.push({ type: "text", text: body });
    for (const img of images ?? []) {
      blocks.push({ type: "image", data: img.data, mimeType: img.mimeType });
    }
    if (blocks.length === 0) blocks.push({ type: "text", text: body || "…" });
    // локальный рендер для пользователя
    const local = images?.length
      ? `${body}${body && images.length ? "\n" : ""}${images.map((_, i) => `🖼 ${i + 1}`).join(" ")}`
      : body;
    this.handlers.onMessage({ id: crypto.randomUUID(), role: "user", text: local });
    await this.connection!.agent.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: blocks,
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
        const rawText = typeof rawIn === "string" ? rawIn : JSON.stringify(rawIn ?? "");
        this.handlers.onMessage({
          id: String(up.toolCallId ?? id), role: "tool",
          text: rawText,
          toolInput: rawText,
          toolName,
          toolStatus: up.status as ChatMessage["toolStatus"],
          subagentSessionId: meta?.subagent_session_id,
        });
        // ── автоконтекст субагенту: пути изображений + напоминание про delegate ──
        // delegate передаёт ТОЛЬКО текст — image-блоки не доходят. Если в сессии
        // есть staged-изображения, шлём субагенту follow-up с путями (session/prompt
        // к его sessionId) — он увидит его следующим ходом и сможет read_image.
        const subId = meta?.subagent_session_id;
        if (subId && /delegate|subagent/i.test(toolName) && this.sessionImagePaths.length > 0) {
          const ctx = `[Контекст от основной сессии]\nИзображения доступны на диске — открывай через read_image с точным путём:\n${this.sessionImagePaths.map((p) => `- ${p}`).join("\n")}`;
          this.connection
            ?.agent.request("session/prompt", {
              sessionId: subId,
              prompt: [{ type: "text", text: ctx }],
            })
            .catch(() => {}); // субагент мог уже завершиться — не критично
        }
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
        // toolInput НЕ трогаем — он сохранён при tool_call и не должен затираться output'ом
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

/** data URL → ACP image {data, mimeType}; null если не data: */
export function dataUrlToImage(dataUrl: string): { data: string; mimeType: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

/** Картинка → сжатый JPEG data URL (max 1024, как Goose Desktop) */
export function compressImageDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1024;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.floor(img.width * scale));
      const h = Math.max(1, Math.floor(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = dataUrl;
  });
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
