/**
 * acp.ts — ACP-сессия к goose serve (порт из pantheon-ui-tauri-legacy без Tauri/DOM).
 * Транспорт: @agentclientprotocol/sdk (experimental/ws-client) + нативный
 * WebSocket Bun — Origin не шлётся (нет custom-protocol), рук в Origin-политику
 * goose не нужно; --allowed-origin base-list остаётся в gooseServer.ts.
 *
 * Сохранено 1:1 (приёмка шага 4): sessionImagePaths registry, [imgs] блок,
 * автоконтекст delegate-субагенту, agent_thought_chunk merge, errText(),
 * parseTodos/cleanTodoText, toolInput не затирается tool_call_update.
 * Убрано: safeInvoke/isTauri (Tauri IPC), compressImageDataUrl (DOM canvas →
 * api/attachments.compressImageBytes на ImageMagick, шаг 8).
 */
import { client, CLIENT_METHODS } from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import { start as startServer, stop as stopServer } from "./api/gooseServer";
import { listSubagentChildren } from "./api/db";

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
  role: "user" | "agent" | "tool" | "thinking";
  text: string;
  toolName?: string;
  toolStatus?: "pending" | "in_progress" | "completed" | "failed";
  subagentSessionId?: string;
  /** создан из agent_message_chunk / agent_thought_chunk — следующие чанки дописываем */
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
  t = t.replace(/^\s*\d+[.)]\s+/, ""); // 1. →
  t = t.replace(/^\s*[-*•]\s+/, ""); // - →
  t = t.replace(/^\[([ xX✓✔])\]\s*/, ""); // [x] →
  t = t.replace(/\s*(✅|☑|✔|—\s*ВЫПОЛНЕНО\s*—?)/gi, "");
  t = t.replace(/\s*—\s*(выполнено|в процессе)\s*$/i, "");
  return t.replace(/\s{2,}/g, " ").trim();
}

/**
 * TODO приходит НЕ апдейтом plan/todos, а вызовом инструмента `todo write`
 * с content=markdown-список (1. ... / - [x] ... / ✅ в конце строки).
 */
export function parseTodos(content: unknown): TodoItem[] {
  if (typeof content !== "string") return [];
  const out: TodoItem[] = [];
  const text = content.replace(/\\n/g, "\n");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const cb = trimmed.match(/^(?:[-*•]\s*)?\[([ xX✓✔~])\]\s*(.*)$/);
    const num = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (cb) {
      const done = cb[1].toLowerCase() !== " " && cb[1] !== "~";
      const progress = cb[1] === "~";
      out.push({
        content: cleanTodoText(cb[2]),
        status: progress ? "in_progress" : done ? "completed" : "pending",
      });
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
 * Ошибки WebSocket приезжают Event'ом → String(e) = «[object Event]».
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
  /** usage_update: used = токены в контексте, size = окно (из ACP UsageUpdate) */
  onUsage?: (u: { used: number; size?: number }) => void;
  onReady: () => void;
  onError: (e: string) => void;
};

type AnyConn = {
  agent: { request(m: string, p: any): Promise<any>; notify(m: string, p: any): void };
};

export class AcpSession {
  private connection: AnyConn | null = null;
  private sessionId: string | null = null;
  private handlers: Handlers;
  status: AcpStatus = "idle";
  /** реестр путей staged-изображений сессии — пробрасываем субагентам через delegate context */
  private sessionImagePaths: string[] = [];
  /** после stop/disconnect — гасим все коллбэки и запросы (защита от «ACP connection closed» в новой сессии) */
  private dead = false;
  private wsStream: { writable?: { close?: () => Promise<void> } } | null = null;

  constructor(h: Handlers) {
    this.handlers = h;
  }

  /** id текущей ACP-сессии — родитель для иерархии субагентов */
  get id(): string | null {
    return this.sessionId;
  }

  async start(workingDir?: string, loadId?: string) {
    this.status = "starting";
    // без location.origin (нет DOM): base exact-list зашит в gooseServer.baseOrigins()
    const serve = await startServer(workingDir);
    const stream = createWebSocketStream(serve.ws_url, { protocols: [] } as never);
    this.wsStream = stream as never;
    this.dead = false;

    const app = client({ name: "mayak-ui" })
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
      clientInfo: { name: "mayak-ui", version: "0.1.0" },
    });

    const cwd = workingDir ?? "/home/quant";
    if (loadId) {
      // открытие существующей сессии: история replay'ится через session/update
      const loaded = (await this.connection.agent.request("session/load", {
        sessionId: loadId,
        cwd,
        mcpServers: [],
      } as never)) as { sessionId?: string };
      // ACP session/load НЕ возвращает sessionId (ключи: modes/configOptions/_meta —
      // проверено сырого против goose). Раньше loaded.sessionId = undefined →
      // sessionId=null → prompt() бросал «сессия не открыта» (Сжатие/отправка в
      // старых чатах падали), applySid пропускался → sid не менялся → poll субагентов
      // опрашивал чужую сессию и панель исчезала. Берём запрошенный id.
      this.sessionId = loaded?.sessionId ?? loadId;
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
  async prompt(text: string, images?: { data: string; mimeType: string }[], filePaths?: string[]) {
    if (!this.sessionId) throw new Error("сессия не открыта");
    if (this.dead) throw new Error("сессия закрыта");
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

  /** killServer=true — полный стоп (unmount/retry); false — только закрыть WS, сервер переиспользуется */
  stop(killServer = true) {
    this.dead = true;
    try {
      void this.wsStream?.writable?.close?.();
    } catch {
      /* уже закрыт */
    }
    this.wsStream = null;
    if (killServer) stopServer().catch(() => {});
    this.status = "idle";
    this.sessionId = null;
    this.connection = null;
  }

  /** Смена чата: закрыть WS, НЕ убивая goose serve (иначе — «ACP connection closed» у новой сессии) */
  disconnect() {
    this.stop(false);
  }

  private handleSessionUpdate(u: Record<string, any>) {
    if (this.dead) return;
    const up = u.update ?? u;
    const kind: string = up.sessionUpdate ?? "";
    const id: string = up.sessionId ?? up.toolCallId ?? crypto.randomUUID();

    switch (kind) {
      case "agent_message_chunk": {
        const text =
          typeof up.content === "object" && up.content
            ? String(up.content.text ?? "")
            : String(up.content ?? "");
        this.handlers.onMessage({ id, role: "agent", text });
        break;
      }
      case "agent_thought_chunk": {
        const text =
          typeof up.content === "object" && up.content
            ? String(up.content.thinking ?? up.content.text ?? "")
            : String(up.content ?? "");
        if (text) this.handlers.onMessage({ id, role: "thinking", text });
        break;
      }
      case "user_message_chunk": {
        // История: goose replay'ит сообщения пользователя ТОЛЬКО этим типом —
        // без обработки «мои сообщения» исчезали после переключения чата/рестарта.
        // В живую goose НЕ шлёт user_message_chunk (проверено: локальный echo в
        // prompt() остаётся единственным источником) — дублей не будет.
        const uc = up.content;
        const utext = typeof uc === "object" && uc ? String(uc.text ?? "") : String(uc ?? "");
        if (utext) this.handlers.onMessage({ id: String(up.messageId ?? id), role: "user", text: utext });
        break;
      }
      case "usage_update": {
        const used = typeof up.used === "number" ? up.used : null;
        const size = typeof up.size === "number" ? up.size : undefined;
        if (used !== null) this.handlers.onUsage?.({ used, size });
        break;
      }
      case "tool_call": {
        const meta = (up._meta ?? {}) as { subagent_session_id?: string };
        const toolName = String(up.title ?? up.kind ?? "tool");
        const rawIn = up.rawInput;
        // todo write → парсим контент в чек-лист правой панели (нативные галочки)
        if (/todo/i.test(toolName) && rawIn && typeof rawIn === "object") {
          const items = parseTodos(
            (rawIn as { content?: unknown }).content ?? (rawIn as { text?: unknown }).text,
          );
          if (items.length) this.handlers.onTodo(items);
        }
        const rawText = typeof rawIn === "string" ? rawIn : JSON.stringify(rawIn ?? "");
        this.handlers.onMessage({
          id: String(up.toolCallId ?? id),
          role: "tool",
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
          const ctx = `[Контекст от основной сессии]\nИзображения доступны на диске — открывай через read_image с точным путём:\n${this.sessionImagePaths
            .map((p) => `- ${p}`)
            .join("\n")}`;
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

export interface SubagentRow {
  id: string;
  label: string;
  tokens: number;
  running: boolean;
}
/** Субагенты ИЕРАРХИЧЕСКИ: только дети parentId. Без parentId — пусто (иерархия, не плоский список). */
export const listSubagents = (parentId?: string | null): SubagentRow[] => {
  if (!parentId) return [];
  // прямой запрос детей (listSubagentChildren), а НЕ filter по listSessions:
  // тот обрезается LIMIT 100 и теряет детей старых сессий
  const rows = listSubagentChildren(parentId);
  return rows
    .slice(0, 12)
    .map((r) => ({
      id: r.id,
      label: r.title || "Субагент",
      tokens: r.total_tokens ?? 0,
      running: !!r.running,
    }));
};
