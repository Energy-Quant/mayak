/**
 * acp.ts — ACP session to goose serve (ported from pantheon-ui-tauri-legacy, no Tauri/DOM).
 * Transport: @agentclientprotocol/sdk (experimental/ws-client) + native Bun
 * WebSocket — no Origin header is sent (no custom protocol), so there is no need
 * to fight goose's Origin policy; the --allowed-origin base list lives in gooseServer.ts.
 *
 * Kept 1:1 (step 4 acceptance): sessionImagePaths registry, [imgs] block,
 * auto-context for delegate subagents, agent_thought_chunk merge, errText(),
 * parseTodos/cleanTodoText, toolInput preserved across tool_call_update.
 * Removed: safeInvoke/isTauri (Tauri IPC), compressImageDataUrl (DOM canvas →
 * api/attachments.compressImageBytes on ImageMagick, step 8).
 */
import { client, CLIENT_METHODS } from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import { start as startServer, stop as stopServer, healthCheck } from "./api/gooseServer";
import { listSubagentChildren, recordUsage } from "./api/db";
import { getGooseMode, setGooseModeListener } from "./api/config";
import { log } from "./logger";
import { AppError, E } from "./errors";

/** Chat attachment: images travel as an ACP image block; documents are staged to tmp and sent as a path in the text */
export interface Attachment {
  id: string;
  name: string;
  /** preview (data URL) — images only */
  dataUrl?: string;
  /** base64 without prefix — for the ACP image block */
  data?: string;
  mimeType?: string;
  /** staged path — documents (as in the original Goose drop) */
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
  /** created from agent_message_chunk / agent_thought_chunk — subsequent chunks append to it */
  chunk?: boolean;
  /** raw tool input JSON — kept separately so tool_call_update cannot overwrite it */
  toolInput?: string;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

/** Strip service markers from a TODO line: "1. ", "- [x] ", "✅", "— DONE —", trailing quotes */
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
 * TODOs arrive NOT as a plan/todos update, but as a `todo write` tool call
 * with content = a markdown list (1. ... / - [x] ... / ✅ at line end).
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

/**
 * P16: ACP session state machine.
 * idle → connecting → ready → streaming → closed
 *                 ↘ error ↗ (may reconnect → connecting)
 * Valid transitions are fixed — invalid ones are ignored with a log entry.
 */
export type SessionState = "idle" | "connecting" | "ready" | "streaming" | "closed" | "error";

const VALID_TRANSITIONS: Record<SessionState, SessionState[]> = {
  idle: ["connecting", "closed"],
  connecting: ["ready", "error", "closed"],
  ready: ["streaming", "error", "closed", "connecting"], // connecting = reconnect
  streaming: ["ready", "error", "closed"],
  error: ["connecting", "closed"], // reconnect or bury it
  closed: ["connecting"], // only a full new start (resurrect)
};

export type AcpStatus = SessionState;

/**
 * WebSocket errors arrive as an Event → String(e) = "[object Event]".
 * Parse them into readable text (type/code/message/error).
 */
export function errText(e: unknown): string {
  // structured error → user-facing text (never the internal detail)
  if (e && typeof e === "object" && "userMessage" in e && "code" in e) {
    const ae = e as { userMessage: string; code: string; detail: string };
    log.debug("errText.appError", `${ae.code}: ${ae.detail}`);
    return ae.userMessage;
  }
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

/** One option offered by goose in session/request_permission (ACP PermissionOption). */
export interface PermissionOptionView {
  optionId: string;
  name: string;
  kind: string;
}

/** UI-facing view of an incoming session/request_permission (P0). */
export interface PermissionRequest {
  sessionId: string | null;
  toolCallId: string;
  toolName: string;
  /** effective GooseMode id (auto/approve/smart_approve/chat) */
  mode: string;
  options: PermissionOptionView[];
}

/** session/request_permission response: user-selected option or cancelled. */
type PermissionOutcome = { outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } };

type Handlers = {
  onMessage: (m: ChatMessage) => void;
  onUpdateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  onTodo: (items: TodoItem[]) => void;
  /** usage_update: used = tokens in context, size = window (from ACP UsageUpdate) */
  onUsage?: (u: { used: number; size?: number }) => void;
  onReady: () => void;
  onError: (e: string) => void;
  /** P6: subagent created/updated event (tool_call carrying subagent_session_id) */
  onSubagentEvent?: (id: string) => void;
  /**
   * P0: user-facing permission dialog. Return the selected optionId, or
   * null/undefined to deny. When absent, permission requests are denied by
   * default (auto-allow only in GooseMode "auto").
   */
  onRequestPermission?: (req: PermissionRequest) => Promise<string | null> | string | null;
};

type AnyConn = {
  agent: { request(m: string, p: any): Promise<any>; notify(m: string, p: any): void };
};

export class AcpSession {
  private connection: AnyConn | null = null;
  private sessionId: string | null = null;
  private handlers: Handlers;
  status: SessionState = "idle";
  /** registry of staged image paths for the session — passed to subagents via delegate context */
  private sessionImagePaths: string[] = [];
  /** P16: state machine. dead() = state==="closed" (compatibility shim). */
  private state: SessionState = "idle";
  /** P2 watchdog: health-check interval + auto-reconnect with backoff */
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  /** Guards overlapping watchdog ticks (healthCheck + backoff sleep may outlive the interval). */
  private watchdogTickInFlight = false;
  /** Bumped by stop(): invalidates in-flight async start work (stale-generation guard). */
  private generation = 0;
  /** Tail of the per-instance operation queue: start/load never overlap (watchdog vs UI). */
  private opTail: Promise<unknown> = Promise.resolve();
  private reconnectAttempts = 0;
  private static readonly WATCHDOG_MS = 10_000;
  private static readonly MAX_BACKOFF = 8000;
  private wsStream: { writable?: { close?: () => Promise<void> } } | null = null;
  /** Current ACP session mode id (goose 1.52 session modes; drives permission policy) */
  private currentModeId: string | null = null;

  constructor(h: Handlers) {
    this.handlers = h;
    // Settings → setGooseMode must reach the LIVE session via session/set_mode,
    // not only config.yaml (applies to sessions started later).
    setGooseModeListener((mode) => void this.applyModeToSession(mode));
  }

  /** P16: validated transition. Invalid → ignored with a warn. */
  private transition(next: SessionState): boolean {
    const cur = this.state;
    if (!VALID_TRANSITIONS[cur].includes(next)) {
      log.warn("acp.state.invalid", `${cur} → ${next} (ignored)`);
      return false;
    }
    if (cur !== next) {
      log.info("acp.state", `${cur} → ${next}`);
      this.state = next;
      this.status = next;
    }
    return true;
  }

  /** Compatibility: replaces the old `dead` boolean. */
  private get isClosed(): boolean {
    return this.state === "closed";
  }

  /** id of the current ACP session — parent for the subagent hierarchy */
  get id(): string | null {
    return this.sessionId;
  }

  /**
   * Start (or restart) the ACP session. Serialized per instance through
   * enqueue(): a watchdog reconnect can never overlap a UI-driven start/load.
   */
  async start(workingDir?: string, loadId?: string): Promise<void> {
    return this.enqueue(() => this.doStart(workingDir, loadId));
  }

  /** Per-instance async mutex: operations run one after another, link rejections are swallowed. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.opTail.then(fn, fn);
    this.opTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Stale-generation guard: if stop() ran while this start was awaiting,
   * undo anything assigned after the cleanup and abort — a stopped session
   * must never resurrect from a late await.
   */
  private abortIfStale(gen: number, where: string): boolean {
    if (gen === this.generation) return false;
    log.debug("acp.start.stale", `where=${where} gen=${gen} current=${this.generation}`);
    void this.wsStream?.writable?.close?.();
    this.wsStream = null;
    this.connection = null;
    this.sessionId = null;
    return true;
  }

  private async doStart(workingDir?: string, loadId?: string): Promise<void> {
    log.start("acp.start", `loadId=${loadId ?? "new"} dir=${workingDir ?? "default"}`);
    const gen = this.generation;
    this.transition("connecting");
    try {
      // No location.origin (no DOM): base exact-list is compiled into gooseServer.baseOrigins().
      const serve = await startServer(workingDir);
      if (this.abortIfStale(gen, "after-spawn")) return;
      const stream = createWebSocketStream(serve.ws_url, { protocols: [] } as never);
      this.wsStream = stream as never;
      // Resurrect from closed is allowed (VALID: closed→connecting already passed).

      const app = client({ name: "mayak-ui" })
        // P0 security: never auto-allow — decision lives in handlePermissionRequest
        .onRequest(
          CLIENT_METHODS.session_request_permission,
          async (ctx: { params: Record<string, unknown> }) =>
            this.handlePermissionRequest((ctx?.params ?? {}) as Record<string, unknown>),
        )
        .onNotification(CLIENT_METHODS.session_update, async (ctx: { params: Record<string, unknown> }) => {
          this.handleSessionUpdate(ctx.params);
        });
      this.connection = app.connect(stream) as unknown as AnyConn;

      await this.connection.agent.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "mayak-ui", version: "0.1.0" },
      });
      if (this.abortIfStale(gen, "after-initialize")) return;

      const cwd = workingDir ?? "/home/quant";
      if (loadId) {
        // Open an existing session: goose replays its history via session/update.
        const loaded = (await this.connection.agent.request("session/load", {
          sessionId: loadId,
          cwd,
          mcpServers: [],
        } as never)) as { sessionId?: string; modes?: { currentModeId?: string } | null };
        // ACP session/load does NOT return sessionId (keys: modes/configOptions/_meta —
        // verified raw against goose). When loaded.sessionId is undefined →
        // sessionId=null → prompt() threw "session not open" (compress/send in old
        // chats failed), applySid was skipped → sid unchanged → the subagent poll
        // watched a foreign session and the panel disappeared. Take the requested id.
        this.sessionId = loaded?.sessionId ?? loadId;
        // Capture goose session mode state (ACP modes.currentModeId) for permission policy.
        this.currentModeId = loaded?.modes?.currentModeId ?? this.currentModeId;
        log.info("acp.start.loaded", `session=${this.sessionId} fromLoad=${loaded?.sessionId ?? "undefined"} mode=${this.currentModeId ?? "-"}`);
      } else {
        const created = (await this.connection.agent.request("session/new", {
          cwd,
          mcpServers: [],
        } as never)) as { sessionId: string; modes?: { currentModeId?: string } | null };
        this.sessionId = created.sessionId;
        this.currentModeId = created.modes?.currentModeId ?? this.currentModeId;
        log.info("acp.start.created", `session=${this.sessionId} mode=${this.currentModeId ?? "-"}`);
      }
      if (this.abortIfStale(gen, "after-session")) return;
      // Push GOOSE_MODE from config.yaml onto the live session (goose 1.52 session/set_mode).
      await this.pushConfigMode();
      if (this.abortIfStale(gen, "before-ready")) return;
      this.transition("ready");
      this.handlers.onReady();
      // P2: watchdog per active session.
      this.startWatchdog();
    } catch (e) {
      if (gen !== this.generation) {
        // Session was stopped while starting — the failure belongs to a dead generation.
        log.debug("acp.start.stale-error", e instanceof Error ? e.message : String(e));
        return;
      }
      this.transition("error");
      log.fail("acp.start", e);
      throw e;
    }
  }

  /** Open an existing session (session/load): goose replays the history itself. Serialized like start(). */
  async load(sessionId: string, workingDir?: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.connection) {
        this.stop();
      }
      await this.doStart(workingDir, sessionId);
    });
  }

  /**
   * session/prompt: text + image blocks (Ctrl+V) + staged document paths.
   * Parity with original Goose: images → ACP image, files → path in text.
   */
  async prompt(text: string, images?: { data: string; mimeType: string }[], filePaths?: string[]) {
    if (!this.connection || !this.sessionId) {
      log.error("acp.prompt", "session not open");
      throw new AppError(E.ACP_NO_SESSION, "prompt: session not open");
    }
    if (this.isClosed) {
      log.error("acp.prompt", "session closed");
      throw new AppError(E.ACP_DEAD, "prompt: session closed", { recoverable: true });
    }
    log.start("acp.prompt", `chars=${text.length} images=${images?.length ?? 0} files=${filePaths?.length ?? 0}`);
    let body = text;
    // register paths for subagent context
    if (filePaths?.length) {
      for (const p of filePaths) {
        if (!this.sessionImagePaths.includes(p)) this.sessionImagePaths.push(p);
      }
      const paths = filePaths.join(" ");
      body = body ? `${body}\n${paths}` : paths;
    }
    // [imgs] — machine-readable path block: system.md requires forwarding them in delegate context
    if (this.sessionImagePaths.length > 0) {
      body += `\n\n[imgs] ${this.sessionImagePaths.join(" ")}`;
    }
    const blocks: Record<string, unknown>[] = [];
    if (body) blocks.push({ type: "text", text: body });
    for (const img of images ?? []) {
      blocks.push({ type: "image", data: img.data, mimeType: img.mimeType });
    }
    if (blocks.length === 0) blocks.push({ type: "text", text: body || "…" });
    // local render for the user
    const local = images?.length
      ? `${body}${body && images.length ? "\n" : ""}${images.map((_, i) => `🖼 ${i + 1}`).join(" ")}`
      : body;
    this.handlers.onMessage({ id: crypto.randomUUID(), role: "user", text: local });
    await this.connection.agent.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: blocks,
    });
  }

  async cancel() {
    // connection can be null when stop() raced an in-flight prompt — never notify on a dead socket
    if (this.connection && this.sessionId) {
      this.connection.agent.notify("session/cancel", { sessionId: this.sessionId });
    }
  }

  /** P2: start the watchdog (health check every 10s + auto-reconnect) */
  startWatchdog(): void {
    this.stopWatchdog();
    this.reconnectAttempts = 0;
    this.watchdogTimer = setInterval(() => void this.watchdogTick(), AcpSession.WATCHDOG_MS);
    log.debug("acp.watchdog.start", `interval=${AcpSession.WATCHDOG_MS}ms`);
  }

  stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /** One watchdog tick: sidecar health; on failure — reconnect with backoff. */
  private async watchdogTick(): Promise<void> {
    if (this.isClosed) return this.stopWatchdog();
    // Skip the tick while a previous one still runs (healthCheck + backoff may outlive the interval).
    if (this.watchdogTickInFlight) return;
    this.watchdogTickInFlight = true;
    try {
      await this.watchdogWork();
    } finally {
      this.watchdogTickInFlight = false;
    }
  }

  private async watchdogWork(): Promise<void> {
    const h = await healthCheck();
    if (h.ok) {
      this.reconnectAttempts = 0;
      return;
    }
    log.warn("acp.watchdog.unhealthy", h.reason ?? "unknown");
    this.handlers.onError(`goose serve: ${h.reason ?? "недоступен"} — переподключение…`);
    const backoff = Math.min(
      1000 * 2 ** this.reconnectAttempts,
      AcpSession.MAX_BACKOFF,
    );
    this.reconnectAttempts++;
    log.info("acp.watchdog.reconnect", `attempt=${this.reconnectAttempts} backoff=${backoff}ms`);
    await new Promise((r) => setTimeout(r, backoff));
    if (this.isClosed) return;
    try {
      const sid = this.sessionId;
      const wasLoad = !!sid;
      await this.start(undefined, wasLoad ? sid : undefined);
      // start() is queued: stop() may have run while we waited — then there is nothing to report
      if (this.isClosed) return;
      this.reconnectAttempts = 0;
      log.info("acp.watchdog.reconnected", `session=${this.sessionId}`);
    } catch (e) {
      log.fail("acp.watchdog.reconnect", e);
      if (!this.isClosed) this.transition("error");
    }
  }

  /** killServer=true — full stop (unmount/retry); false — close the WS only, the server is reused */
  stop(killServer = true) {
    this.generation++; // invalidate any in-flight doStart (stale-generation guard)
    this.transition("closed");
    try {
      void this.wsStream?.writable?.close?.();
    } catch (e) {
      log.debug("acp.stop.ws-close", e instanceof Error ? e.message : String(e));
    }
    this.stopWatchdog();
    this.wsStream = null;
    if (killServer) stopServer().catch((e) => log.fail("acp.stop.stopServer", e));
    // state is already closed; status stays "idle" for the UI until the next start
    this.sessionId = null;
    this.connection = null;
  }

  /** Chat switch: close the WS WITHOUT killing goose serve (else the new session gets "ACP connection closed") */
  disconnect() {
    this.stop(false);
  }

  /** Effective GooseMode for permission decisions (session state first, config.yaml fallback). */
  private permissionMode(): string {
    if (this.currentModeId) return this.currentModeId;
    try {
      return getGooseMode();
    } catch (e) {
      log.debug("acp.permission.mode-fallback", e instanceof Error ? e.message : String(e));
      return "approve"; // config.yaml unreadable → documented GooseMode fallback (policy unchanged)
    }
  }

  /**
   * P0 security: incoming session/request_permission is NEVER silently allowed.
   * Every request is logged (audit trail: acp.permission.request). Decision order:
   *  1. explicit Handlers.onRequestPermission (UI dialog) — its choice wins;
   *     no/invalid choice denies;
   *  2. without a handler only GooseMode "auto" auto-allows (explicit opt-in);
   *  3. otherwise deny (reject_once option, falling back to cancelled).
   */
  private async handlePermissionRequest(params: Record<string, unknown>): Promise<PermissionOutcome> {
    const p = params as {
      sessionId?: unknown;
      toolCall?: { toolCallId?: unknown; name?: unknown; title?: unknown; kind?: unknown };
      options?: Array<{ optionId: string; name?: string; kind?: string }>;
    };
    const options = Array.isArray(p.options) ? p.options : [];
    const toolCallId = String(p.toolCall?.toolCallId ?? "");
    const toolName = String(p.toolCall?.name ?? p.toolCall?.title ?? p.toolCall?.kind ?? "unknown");
    const mode = this.permissionMode();
    log.warn(
      "acp.permission.request",
      `tool=${toolName} call=${toolCallId || "-"} session=${String(p.sessionId ?? this.sessionId ?? "-")} mode=${mode} options=${options.map((o) => o.kind ?? o.optionId).join(",") || "-"}`,
    );

    const deny = (reason: string): PermissionOutcome => {
      log.warn("acp.permission.deny", `tool=${toolName} mode=${mode} reason=${reason}`);
      const reject =
        options.find((o) => o.kind === "reject_once") ?? options.find((o) => o.kind === "reject_always");
      return reject
        ? { outcome: { outcome: "selected", optionId: reject.optionId } }
        : { outcome: { outcome: "cancelled" } };
    };

    // 1) UI handler (if wired) makes the final call.
    if (this.handlers.onRequestPermission) {
      let selected: string | null = null;
      try {
        selected = await this.handlers.onRequestPermission({
          sessionId: (typeof p.sessionId === "string" && p.sessionId) || this.sessionId,
          toolCallId,
          toolName,
          mode,
          options: options.map((o) => ({ optionId: o.optionId, name: o.name ?? "", kind: o.kind ?? "" })),
        });
      } catch (e) {
        log.warn("acp.permission.handler-error", `tool=${toolName} ${e instanceof Error ? e.message : String(e)}`);
        selected = null;
      }
      if (selected && options.some((o) => o.optionId === selected)) {
        log.warn("acp.permission.grant", `tool=${toolName} option=${selected} via=ui`);
        return { outcome: { outcome: "selected", optionId: selected } };
      }
      return deny("ui-no-selection");
    }

    // 2) No handler: auto-allow ONLY in the explicit auto mode.
    if (mode === "auto") {
      const allow = options.find((o) => o.kind === "allow_once") ?? options.find((o) => o.kind === "allow_always");
      if (allow) {
        log.warn("acp.permission.auto-allow", `tool=${toolName} option=${allow.optionId} mode=auto`);
        return { outcome: { outcome: "selected", optionId: allow.optionId } };
      }
      return deny("no-allow-option");
    }

    // 3) Secure default: no explicit confirmation path → block.
    return deny("no-ui-handler");
  }

  /** Push GOOSE_MODE from config.yaml onto the live session (goose 1.52 session/set_mode). */
  private async pushConfigMode(): Promise<void> {
    if (!this.connection || !this.sessionId) return;
    let mode: string;
    try {
      mode = getGooseMode();
    } catch (e) {
      log.debug("acp.mode.config-read", e instanceof Error ? e.message : String(e));
      return;
    }
    if (!mode || mode === this.currentModeId) return;
    await this.applyModeToSession(mode);
  }

  /** Set the live session mode via ACP session/set_mode; failures are logged, never fatal. */
  private async applyModeToSession(mode: string): Promise<void> {
    if (this.isClosed || !this.connection || !this.sessionId) return;
    try {
      await this.connection.agent.request("session/set_mode", { sessionId: this.sessionId, modeId: mode });
      this.currentModeId = mode;
      log.info("acp.mode.set", `session=${this.sessionId} mode=${mode}`);
    } catch (e) {
      log.warn("acp.mode.set.failed", `mode=${mode} ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private handleSessionUpdate(u: Record<string, any>) {
    if (this.isClosed) return;
    const up = u.update ?? u;
    const kind: string = up.sessionUpdate ?? "";
    const id: string = up.sessionId ?? up.toolCallId ?? crypto.randomUUID();

    switch (kind) {
      case "agent_message_chunk": {
        this.transition("streaming");
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
        // History: goose replays user messages ONLY via this update type —
        // without handling it "my messages" vanished after a chat switch/restart.
        // Live goose does NOT send user_message_chunk (verified: the local echo in
        // prompt() remains the only source) — so no duplicates appear.
        const uc = up.content;
        const utext = typeof uc === "object" && uc ? String(uc.text ?? "") : String(uc ?? "");
        if (utext) this.handlers.onMessage({ id: String(up.messageId ?? id), role: "user", text: utext });
        break;
      }
      case "usage_update": {
        const used = typeof up.used === "number" ? up.used : null;
        const size = typeof up.size === "number" ? up.size : undefined;
        if (used !== null) {
          this.handlers.onUsage?.({ used, size });
          // P2 telemetry: feed per-role usage ledger (never breaks the caller)
          recordUsage({
            session_id: this.sessionId ?? "-",
            input_tokens: used,
          });
        }
        break;
      }
      case "tool_call": {
        const meta = (up._meta ?? {}) as { subagent_session_id?: string };
        const toolName = String(up.title ?? up.kind ?? "tool");
        const rawIn = up.rawInput;
        // todo write → parse content into the right-panel checklist (native checkboxes)
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
        // P6: event-driven rail trigger — no need to wait for the poll
        if (meta?.subagent_session_id) this.handlers.onSubagentEvent?.(meta.subagent_session_id);
        // ── auto-context for the subagent: image paths + delegate reminder ──
        // delegate forwards TEXT ONLY — image blocks never arrive. If the session has
        // staged images, send the subagent a follow-up with the paths (session/prompt
        // to its sessionId) — it will see it on the next turn and can read_image.
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
            .catch((e) => log.warn("acp.auto-context.subagent", `sub=${subId} ${e instanceof Error ? e.message : e}`)); // the subagent may have already finished
        }
        break;
      }
      case "tool_call_update": {
        const patch: Partial<ChatMessage> = { toolStatus: up.status as ChatMessage["toolStatus"] };
        let text: string | undefined;
        const body = up.rawOutput?.content?.[0];
        if (typeof body === "object" && body && body.text !== undefined) text = String(body.text ?? "");
        else if (typeof up.rawOutput === "string") text = up.rawOutput;
        // todo write returns the updated list in rawOutput — reparse it (✅/— checkboxes)
        if (/todo/i.test(String((up as any).title ?? (up as any).kind ?? "")) && text) {
          const items = parseTodos(text);
          if (items.length) this.handlers.onTodo(items);
        }
        // pass text only when it is actually present: spreading text:undefined OVERWROTE
        // the already-rendered text → "undefined is not an object (m.text.slice)" and a render crash
        if (text !== undefined) patch.text = text;
        // toolInput is NOT touched — it was saved at tool_call and must not be clobbered by output
        this.handlers.onUpdateMessage(String(up.toolCallId ?? ""), patch);
        break;
      }
      case "current_mode_update": {
        // Track goose mode changes (e.g. after session/set_mode) for permission policy.
        const mode = String(up.currentModeId ?? "");
        if (mode) {
          this.currentModeId = mode;
          log.info("acp.mode.update", `mode=${mode}`);
        }
        break;
      }
      default: {
        const entries = up.plan?.entries ?? up.todos ?? (up as any).todos;
        if (Array.isArray(entries)) {
          // plan-entries arrive as raw lines ("1. …", "# Heading", ✅) — clean them up
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

/** data URL → ACP image {data, mimeType}; null when not a data: URL */
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
/** Subagents HIERARCHICALLY: only children of parentId. Without parentId → empty (a hierarchy, not a flat list). */
export const listSubagents = (parentId?: string | null): SubagentRow[] => {
  if (!parentId) return [];
  // direct children query (listSubagentChildren), NOT a filter over listSessions:
  // that one is capped by LIMIT 100 and loses children of old sessions
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
