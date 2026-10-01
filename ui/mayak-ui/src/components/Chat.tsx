/**
 * Chat — ACP chat on GPUIX (port of Chat.tsx rev14 without Tauri/DOM/webview).
 * GPUIX specifics: <virtual-list alignment="bottom" followTail>, <markdown> host,
 * expandable preview+Show more (no inner scroll), pointer-capture resize.
 * Attachments (Ctrl+V/DnD/picker) — step 8; events replaced by App props.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGpuix, type EventPayload, type PublicInstance } from "@gpuix/react";
import {
  AcpSession,
  listSubagents,
  errText,
  dataUrlToImage,
  type Attachment,
  type ChatMessage,
  type SubagentRow,
  type TodoItem,
} from "../acp";
import { getConfigSummary, getConfigLimits, getAgentChains } from "../api/config";
import { getProviderCatalog } from "../api/catalog";
import { listSessions } from "../api/db";
import { clipboardImage, copyText } from "../api/clipboard";
import {
  compressImageBytes,
  readFileBytes,
  stageAttachment,
  toBase64,
  toDataUrl,
} from "../api/attachments";
import { winKeys } from "../windowKeys";
import { chatSession, setLastSid } from "../chatSession";
import PantheonRoleBadge from "./PantheonRoleBadge";
import { Icon } from "./Icon";
import { useDragWidth } from "../useDragWidth";
import UsageBar from "./UsageBar";
import { Markdown, UserText, italicize } from "./md";
import { ToolBody, type ToolTheme } from "./toolRender";
import { fs, font, sp, type WaveTheme } from "../tokens";
import { log } from "../logger";

function greeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Доброе утро";
  if (h >= 12 && h < 18) return "Добрый день";
  if (h >= 18 && h < 23) return "Добрый вечер";
  return "Доброй ночи";
}

function Clock(props: { t: WaveTheme }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(iv);
  }, []);
  return (
    <div style={{display: "flex", flexDirection: "column",  alignItems: "center", gap: 6, marginBottom: sp[5] }}>
      <text
        style={{
          fontSize: 56,
          fontWeight: 250,
          color: props.t.magenta,
          fontFamily: font,
          whiteSpace: "nowrap",
        }}
      >
        {`${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`}
      </text>
      <text style={{ fontSize: fs.lg, color: props.t.dim }}>{greeting()}</text>
    </div>
  );
}

function fmtTokens(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return String(n);
}

function statusLabelBase(s: string) {
  return (
    { idle: "не подключено", starting: "подключение…", ready: "готов", error: "ошибка" }[s] ?? s
  );
}

/** Collapsed/expanded body: preview + Show more (the outer list scrolls) */
function ExpandableBody(props: {
  children: ReactNode;
  t: WaveTheme;
  collapsed?: number;
  label?: string;
}) {
  const { collapsed = 110, label = "Раскрыть полностью" } = props;
  const [open, setOpen] = useState(false);
  return (
    <div style={{display: "flex",  flexDirection: "column", gap: 4, minWidth: 0, flexGrow: 1 }}>
      <div
        style={
          open
            ? {display: "flex",  flexDirection: "column", minWidth: 0, width: "100%" }
            : {display: "flex", 
                maxHeight: collapsed,
                overflow: "hidden",
                flexDirection: "column",
                minWidth: 0,
              }
        }
      >
        {props.children}
      </div>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{display: "flex", flexDirection: "column", 
          alignSelf: "flex-start",
          paddingLeft: 10,
          paddingRight: 10,
          paddingTop: 2,
          paddingBottom: 2,
          borderRadius: 99,
          borderWidth: 1,
          borderColor: props.t.border,
          cursor: "pointer",
        }}
      >
        <text style={{ fontSize: fs.xs2, color: props.t.faint }}>
          {open ? "▲ Свернуть" : `▼ ${label}`}
        </text>
      </div>
    </div>
  );
}

function CopyBtn(props: { text: string; t: WaveTheme; light?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    copyText(props.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [props.text]);
  const border = props.light ? "rgba(255,255,255,0.45)" : props.t.border;
  const fg = props.light ? "#ffffff" : copied ? props.t.green : props.t.faint;
  return (
    <div
      onClick={copy}
      style={{
        paddingLeft: 6,
        paddingRight: 6,
        paddingTop: 2,
        paddingBottom: 2,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: border,
        cursor: "pointer",
        opacity: 0.85,
      }}
    >
      <text style={{ fontSize: fs.xs, color: fg }}>{copied ? "✓" : "⧉"}</text>
    </div>
  );
}

/** Smooth pulse (sin): active → opacity 0.35..1, otherwise 1 */
function usePulse(active: boolean, periodMs = 1100): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setTick((x) => x + 1), 80);
    return () => clearInterval(iv);
  }, [active]);
  if (!active) return 1;
  const phase = ((tick * 80) / periodMs) * Math.PI * 2;
  return 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(phase));
}

const SPIN_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
/** Braille spinner for long-running tools */
function useSpinner(active: boolean): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setI((x) => x + 1), 100);
    return () => clearInterval(iv);
  }, [active]);
  return active ? SPIN_FRAMES[i % SPIN_FRAMES.length] : "";
}

const MessageItem = React.memo(function MessageItem(props: {
  m: ChatMessage;
  t: WaveTheme;
  onSubagent: (id: string) => void;
  streaming: boolean;
  isLast: boolean;
}) {
  const { m, t } = props;
  const [open, setOpen] = useState(false);
  const th: ToolTheme = useMemo(
    () => ({
      dim: t.dim,
      faint: t.faint,
      text: t.text,
      cyan: t.cyan,
      magenta: t.magenta,
      green: t.green,
      gold: t.gold,
      glass: t.glass,
      border: t.border,
    }),
    [t],
  );

  const copySrc = m.role === "tool" ? (m.toolInput ?? m.text ?? "") : (m.text ?? "");
  // thinking "in progress" = streaming + it is last (only the fresh chain flashes)
  const thinkingActive =
    m.role === "thinking" && props.streaming && !!m.chunk && props.isLast;
  const toolActive =
    m.role === "tool" && (m.toolStatus === "pending" || m.toolStatus === "in_progress");
  const pulse = usePulse(thinkingActive);
  const spin = useSpinner(toolActive);

  if (m.role === "thinking") {
    return (
      <div
        style={{
          display: "flex",
          maxWidth: "96%",
          width: "96%",
          flexDirection: "column",
          gap: 6,
          marginTop: 6,
          marginBottom: 6,
          paddingLeft: 4,
          minWidth: 0,
          position: "relative",
        }}
      >
        <div
          onClick={() => setOpen((v) => !v)}
          style={{
            display: "flex",
            width: "100%",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor: thinkingActive ? t.violet : t.faint,
              opacity: pulse,
              flexShrink: 0,
            }}
          />
          <text style={{ fontSize: fs.xs2, color: t.faint, fontWeight: 650 }}>
            Thinking{thinkingActive ? "…" : ""}
          </text>
          <text style={{ fontSize: fs.xs2, color: t.faint, opacity: 0.8 }}>
            {open ? "▴ свернуть" : "▸ показать"}
          </text>
          <div style={{ flexGrow: 1 }} />
          <CopyBtn text={copySrc} t={t} />
        </div>
        {open ? (
          <div
            style={{
              display: "flex",
              width: "100%",
              flexDirection: "column",
              paddingLeft: 22,
              opacity: 0.65,
            }}
          >
            <Markdown source={italicize(m.text ?? "")} t={t} />
          </div>
        ) : null}
      </div>
    );
  }

  if (m.role === "tool") {
    const failed = m.toolStatus === "failed";
    return (
      <div
        style={{
          display: "flex",
          borderWidth: 1,
          borderColor: failed ? t.error : toolActive ? t.gold : t.border,
          borderRadius: 13,
          padding: 10,
          backgroundColor: t.surface,
          maxWidth: "96%",
          width: "96%",
          flexDirection: "column",
          minWidth: 0,
          opacity: failed ? 0.8 : 1,
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "100%",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              width: 22,
              height: 22,
              borderRadius: 6,
              backgroundColor: t.glass,
              justifyContent: "center",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="app" size={13} color={toolActive ? t.gold : t.cyan} />
          </div>
          {toolActive ? (
            <text style={{ fontSize: fs.md, color: t.gold, whiteSpace: "nowrap" }}>{spin}</text>
          ) : null}
          <text style={{ fontSize: fs.sm, color: t.text, fontWeight: 650 }}>{m.toolName}</text>
          {m.subagentSessionId ? (
            <div
              onClick={() => props.onSubagent(m.subagentSessionId!)}
              style={{
                paddingLeft: 10,
                paddingRight: 10,
                paddingTop: 2,
                paddingBottom: 2,
                borderRadius: 99,
                borderWidth: 1,
                borderColor: t.border,
                cursor: "pointer",
              }}
            >
              <text style={{ fontSize: fs.xs, color: t.magenta }}>↗ субагент</text>
            </div>
          ) : null}
          <div style={{ flexGrow: 1 }} />
          <CopyBtn text={copySrc} t={t} />
        </div>
        <div
          style={{
            display: "flex",
            width: "100%",
            marginTop: 6,
            borderTopWidth: 1,
            paddingTop: 6,
            borderColor: t.border,
            flexDirection: "column",
          }}
        >
          <ExpandableBody t={t} collapsed={96} label="Раскрыть вызов">
            <ToolBody toolName={m.toolName ?? ""} rawText={m.toolInput ?? m.text ?? ""} theme={th} />
          </ExpandableBody>
        </div>
      </div>
    );
  }

  if (m.role === "user") {
    return (
      <div
        style={{
          display: "flex",
          width: "100%",
          flexDirection: "column",
          alignItems: "flex-end",
        }}
      >
        <div
          style={{
            display: "flex",
            maxWidth: "88%",
            width: "100%",
            flexDirection: "column",
            minWidth: 0,
            position: "relative",
            backgroundColor: t.userBubble,
            borderTopRightRadius: 24,
            borderBottomRightRadius: 6,
            borderBottomLeftRadius: 24,
            borderTopLeftRadius: 24,
            paddingLeft: 17,
            paddingRight: 42,
            paddingTop: 12,
            paddingBottom: 12,
          }}
        >
          <UserText text={m.text ?? ""} t={t} fontSize={fs.base} />
          <div style={{ position: "absolute", top: 10, right: 10 }}>
            <CopyBtn text={copySrc} t={t} light />
          </div>
        </div>
      </div>
    );
  }

  // agent
  return (
    <div
      style={{
        display: "flex",
        maxWidth: "96%",
        width: "96%",
        flexDirection: "column",
        minWidth: 0,
        position: "relative",
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: t.border,
        borderTopRightRadius: 24,
        borderBottomRightRadius: 24,
        borderBottomLeftRadius: 6,
        borderTopLeftRadius: 24,
        paddingLeft: 17,
        paddingRight: 42,
        paddingTop: 12,
        paddingBottom: 12,
      }}
    >
      <Markdown source={m.text ?? ""} t={t} />
      <div style={{ position: "absolute", top: 10, right: 10 }}>
        <CopyBtn text={copySrc} t={t} />
      </div>
    </div>
  );
});

export function ChatPage(props: {
  railWidth: number;
  onRailWidth: (w: number) => void;
  /** content width (window − sidebar), px */
  widthPx: number;
  /** increment = "New chat" command (reset + fresh session/new) */
  newChatToken: number;
  /** reports the opened/created session id to App (sidebar highlight) */
  onSessionChange?: (id: string) => void;
  t: WaveTheme;
  onOpenSubagent: (id: string) => void;
  pendingSession: string | null;
  clearPending: () => void;
}) {
  const t = props.t;
  const railDrag = useDragWidth(() => props.railWidth, props.onRailWidth, {
    min: 210,
    max: 480,
    invert: true,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [ctx, setCtx] = useState<{ tokens: number; limit: number | null; threshold: number | null }>({
    tokens: 0,
    limit: null,
    threshold: null,
  });
  const [todos, setTodos] = useState<TodoItem[] | null>(null);
  const [subagents, setSubagents] = useState<SubagentRow[]>([]);
  const [status, setStatus] = useState<"idle" | "starting" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** goose model selected in "Chains" — for the topbar badge */
  const [gooseModel, setGooseModel] = useState({ provider: "opencode_go", model: "glm-5.3-flash" });
  const { renderer } = useGpuix();
  const MAX_ATTACH = 8;
  const sessionRef = useRef<AcpSession | null>(null);
  const startedRef = useRef(false);
  /** id of the last successfully opened session — for auto-reconnect after a WS drop */
  const lastSidRef = useRef<string | null>(null);
  /**
   * sid in React state: a session switch must RESTART the subagent poll effect.
   * lastSidRef (ref) gives no re-render — the effect depended on messages/status and could
   * keep polling the old/empty session ("the subagent panel vanished").
   */
  const [sid, setSid] = useState<string | null>(null);
  const applySid = (id: string | null) => {
    setLastSid(id);
    lastSidRef.current = id;
    setSid(id);
  };

  const makeSession = () =>
    new AcpSession({
      onMessage: (m) =>
        setMessages((ms) => {
          const last = ms[ms.length - 1];
          // Stream: every chunk continues the previous one (same role, chunk=true)
          if ((m.role === "agent" || m.role === "thinking") && last?.role === m.role && last.chunk) {
            return [...ms.slice(0, -1), { ...last, text: last.text + m.text }];
          }
          const msg: ChatMessage =
            m.role === "agent" || m.role === "thinking" ? { ...m, chunk: true } : m;
          return [...ms.slice(-400), msg];
        }),
      onUpdateMessage: (id, patch) =>
        setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m))),
      onTodo: (items) => setTodos(items.length ? items : null),
      onUsage: (u) =>
        setCtx((c) => ({ ...c, tokens: u.used, limit: u.size ?? c.limit })),
      onSubagentEvent: () => {
        // P6: event-driven rail update (tool_call with subagent_session_id)
        // lastSidRef instead of sid — the makeSession closure may be stale
        try {
          const s = lastSidRef.current;
          if (s) setSubagents(listSubagents(s));
        } catch (e) {
          log.debug("ui.subagentEvent", String(e));
        }
      },
      onReady: () => setStatus("ready"),
      onError: (e) => {
        setError(e);
        setStatus("error");
      },
    });

  const connect = useCallback(async () => {
    sessionRef.current?.stop(false);
    setError("");
    setStatus("starting");
    const s = makeSession();
    sessionRef.current = s;
    let active: AcpSession = s;
    try {
      if (chatSession.lastSid) {
        try {
          await s.load(chatSession.lastSid); // history replays via start(loadId)
        } catch (e) { log.debug("ui.error", String(e));
          // stale sid — fallback: new session (session/new)
          s.stop(false);
          // RACE: while lastSid was loading, pendingSession may have already put
          // its own session into sessionRef — do not overwrite it with an empty session/new
          if (sessionRef.current !== s) return;
          const s2 = makeSession();
          sessionRef.current = s2;
          active = s2;
          await s2.start();
        }
      } else {
        await s.start();
      }
      if (sessionRef.current === active && active.id) {
        applySid(active.id);
        props.onSessionChange?.(active.id);
      }
    } catch (e) {
      if (sessionRef.current === active) {
        setError(errText(e).slice(0, 200));
        setStatus("error");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // auto-connect
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void connect();
    return () => sessionRef.current?.stop(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // open a session from History/sidebar (App prop — no window events)
  useEffect(() => {
    if (!props.pendingSession) return;
    const id = props.pendingSession;
    props.clearPending();
    const run = async () => {
      sessionRef.current?.disconnect(); // the server stays up — the next start is instant (reuse)
      setMessages([]);
      setTodos(null);
      setSubagents([]);
      applySid(null); // stop the poll BEFORE async-load: the old interval could flood subagents of the previous session
      setError("");
      setStatus("starting");
      const s = makeSession();
      sessionRef.current = s;
      try {
        await s.load(id);
        if (sessionRef.current === s && s.id) {
          applySid(s.id);
          props.onSessionChange?.(s.id);
        }
      } catch (e) { log.debug("ui.error", String(e));
        // stale sid — fallback: new session (session/new), same as in connect()
        s.stop(false);
        const s2 = makeSession();
        sessionRef.current = s2;
        try {
          await s2.start();
          if (sessionRef.current === s2 && s2.id) {
            applySid(s2.id);
            props.onSessionChange?.(s2.id);
          }
        } catch (e2) {
          if (sessionRef.current === s2) {
            setError(`Не удалось открыть сессию: ${errText(e2).slice(0, 160)}`);
            setStatus("error");
          }
        }
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pendingSession]);

  // goose model from "Chains" (polled — changes in settings are picked up)
  useEffect(() => {
    const load = () => {
      try {
        const ch = getAgentChains().find((c) => c.role === "goose");
        if (ch?.primary?.model)
          setGooseModel({ provider: ch.primary.provider, model: ch.primary.model });
      } catch (e) { log.debug("ui.error", String(e));
        /* toml unavailable — keep the previous value */
      }
    };
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  // "New chat": full reset + fresh session/new (lastSid=null)
  useEffect(() => {
    if (!props.newChatToken) return;
    sessionRef.current?.disconnect();
    setMessages([]);
    setTodos(null);
    setSubagents([]);
    setError("");
    setStreaming(false);
    setAttachments([]);
    applySid(null);
    setStatus("starting");
    const s = makeSession();
    sessionRef.current = s;
    void (async () => {
      try {
        await s.start();
        if (sessionRef.current === s && s.id) {
          applySid(s.id);
          props.onSessionChange?.(s.id);
        }
      } catch (e) {
        if (sessionRef.current === s) {
          setError(errText(e).slice(0, 200));
          setStatus("error");
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.newChatToken]);

  // context limits + auto-compress threshold
  useEffect(() => {
    const load = async () => {
      try {
        const cat = await getProviderCatalog();
        const models = cat.models_by_provider["opencode_go"] ?? [];
        const m = models.find((x) => x.name === "glm-5.3-flash") ?? models[0];
        let c: { goose_auto_compact_threshold: number | null } | null = null;
        try {
          c = getConfigLimits();
        } catch (e) { log.debug("ui.error", String(e));
          c = null;
        }
        setCtx((v) => ({
          ...v,
          limit: m?.context_limit ?? null,
          threshold: c?.goose_auto_compact_threshold ?? null,
        }));
      } catch (e) { log.debug("ui.error", String(e));
        /* catalog unavailable — meter without a limit */
      }
    };
    void load();
  }, []);

  // subagents: poll by sid (React state). Depending on messages/status caused
  // polling before sessionRef was ready (sid=null → empty) and did not restart the interval
  // on session switch → "the subagent panel vanished after switching".
  useEffect(() => {
    if (!sid) {
      setCtx((c) => ({ ...c, tokens: 0 }));
      setSubagents([]);
      return;
    }
    const poll = () => {
      try {
        // tokens come from usage_update (live); the poll only fetches subagents
        setSubagents(listSubagents(sid));
      } catch (e) { log.debug("ui.error", String(e));
        /* silent */
      }
    };
    poll();
    // P6: poll = reconciliation every 15s (events are the primary mechanism)
    const iv = setInterval(poll, 15000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  /** Ingest OS paths (drop / file picker): images → compress+stage, documents → path */
  const ingestPaths = async (paths: string[]) => {
    for (const p of paths) {
      const name = p.split("/").pop() || "file";
      const isImg = /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(p);
      try {
        const bytes = Uint8Array.from(await readFileBytes(p));
        if (isImg) {
          const ext = name.split(".").pop()?.toLowerCase() ?? "png";
          const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          const cmp = compressImageBytes(bytes, mime);
          const staged = stageAttachment(name, bytes);
          const dataUrl = toDataUrl(cmp.bytes, cmp.mimeType);
          const img = dataUrlToImage(dataUrl);
          setAttachments((a) =>
            [
              ...a,
              {
                id: crypto.randomUUID(),
                name,
                kind: "image" as const,
                dataUrl,
                data: img?.data ?? toBase64(cmp.bytes),
                mimeType: img?.mimeType ?? cmp.mimeType,
                path: staged,
              },
            ].slice(0, MAX_ATTACH),
          );
        } else {
          setAttachments((a) =>
            [...a, { id: crypto.randomUUID(), name, kind: "file" as const, path: p }].slice(0, MAX_ATTACH),
          );
        }
      } catch (e) {
        setAttachments((a) =>
          [
            ...a,
            { id: crypto.randomUUID(), name, kind: "file" as const, error: errText(e).slice(0, 80) },
          ].slice(0, MAX_ATTACH),
        );
      }
    }
  };

  /** DnD: the event hits the element UNDER the cursor (it does not bubble) — attach to every large zone */
  const onDropPaths = (ev: { paths?: string[] }) => {
    if (ev.paths?.length) void ingestPaths(ev.paths);
  };

  // Ctrl+V → native wl-paste (parity with the legacy keydown path)
  useEffect(() => {
    winKeys.chat = (e) => {
      if (e.key !== "v" || !e.modifiers?.ctrl || e.modifiers?.shift || e.modifiers?.alt) return;
      try {
        const ci = clipboardImage();
        if (ci && ci.data?.length) {
          const ext = ci.mime.split("/")[1] || "png";
          const raw = Uint8Array.from(ci.data);
          const cmp = compressImageBytes(raw, ci.mime);
          const staged = stageAttachment(`clipboard.${ext}`, raw);
          setAttachments((a) =>
            [
              ...a,
              {
                id: crypto.randomUUID(),
                name: `clipboard.${ext}`,
                kind: "image" as const,
                dataUrl: toDataUrl(cmp.bytes, cmp.mimeType),
                data: toBase64(cmp.bytes),
                mimeType: cmp.mimeType,
                path: staged,
              },
            ].slice(0, 8),
          );
        }
      } catch (e) { log.debug("ui.error", String(e));
        /* no wl-clipboard / not an image */
      }
    };
    return () => {
      winKeys.chat = null;
    };
  }, []);

  const compact = async () => {
    const s = sessionRef.current;
    if (!s || status !== "ready") return;
    setStreaming(true);
    try {
      await s.prompt("/compact");
    } catch (e) {
      if (sessionRef.current === s) {
        const msg = errText(e);
        if (/connection closed|stream is closed/i.test(msg) && lastSidRef.current) {
          void reopenLast();
        } else {
          setError(`Сжатие: ${msg.slice(0, 120)}`);
        }
      }
    } finally {
      if (sessionRef.current === s) setStreaming(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    const s = sessionRef.current;
    const ready = attachments.filter((a) => !a.error && (a.kind === "image" ? a.data : a.path));
    if ((!text && ready.length === 0) || !s || status !== "ready") return;
    setInput("");
    const images = ready
      .filter((a) => a.kind === "image" && a.data && a.mimeType)
      .map((a) => ({ data: a.data as string, mimeType: a.mimeType as string }));
    const paths = ready.filter((a) => a.path).map((a) => a.path as string);
    setAttachments([]);
    setStreaming(true);
    try {
      await s.prompt(text, images.length ? images : undefined, paths.length ? paths : undefined);
    } catch (e) {
      // foreign/dead session after a switch — stay silent (lesson "ACP connection closed")
      if (sessionRef.current !== s) return;
      const msg = errText(e);
      if (/connection closed|stream is closed/i.test(msg) && lastSidRef.current) {
        void reopenLast(); // WS drop → auto-reconnect with history replay
      } else {
        setError(`Ошибка промпта: ${msg.slice(0, 200)}`);
      }
    } finally {
      if (sessionRef.current === s) setStreaming(false);
    }
  };

  /** Auto-reconnect: reopen the last session (goose replays the history) */
  const reopenLast = async () => {
    const id = lastSidRef.current;
    if (!id) return;
    sessionRef.current?.disconnect();
    setError("");
    setStatus("starting");
    // history replays again via session/load — clear the old one, else duplicates
    setMessages([]);
    setTodos(null);
    setSubagents([]);
    const s = makeSession();
    sessionRef.current = s;
    try {
      await s.load(id);
      if (sessionRef.current === s && s.id) {
        applySid(s.id);
      }
    } catch (e) {
      if (sessionRef.current === s) {
        setError(`Переподключение: ${errText(e).slice(0, 160)}`);
        setStatus("error");
      }
    }
  };

  const running = subagents.filter((s) => s.running).length;
  const hasConversation = messages.length > 0;

  const messageRows = useMemo(
    () =>
      messages.map((m, i) => (
        <MessageItem
          key={m.id + i}
          m={m}
          t={t}
          onSubagent={props.onOpenSubagent}
          streaming={streaming}
          isLast={i === messages.length - 1}
        />
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, t, props.onOpenSubagent, streaming],
  );

  // --- Scroll-to-bottom button -------------------------------------------
  // Host child count of <virtual-list>: message rows + the two streaming rows.
  // Kept in a ref so scroll queries always compare against the live list.
  const feedListRef = useRef<PublicInstance | null>(null);
  const feedChildCountRef = useRef(0);
  feedChildCountRef.current = messageRows.length + (streaming ? 2 : 0);
  /** Last endIndex reported by the list's visibleRange event (scroll signal). */
  const feedRangeEndRef = useRef<number | null>(null);
  /** True while the feed shows its tail — drives the floating button. */
  const [feedAtBottom, setFeedAtBottom] = useState(true);

  /**
   * Whether the feed is at the bottom of the list. Primary signal:
   * getListScrollTop — `itemIndex == itemCount` is gpui's at-end sentinel
   * (exact even while row heights are still estimates). Secondary: the
   * visibleRange endIndex reaching the child count (fires on user scrolls).
   */
  const refreshFeedBottom = useCallback(() => {
    const count = feedChildCountRef.current;
    let anchorAtEnd: boolean | null = null;
    const id = feedListRef.current?.id;
    if (id != null && renderer) {
      try {
        const top = renderer.getListScrollTop?.(id);
        if (top && top.length > 0) anchorAtEnd = top[0] >= count;
      } catch (e) {
        log.debug("ui.scroll", String(e));
      }
    }
    const rangeAtEnd = feedRangeEndRef.current != null && feedRangeEndRef.current >= count;
    const atEnd = anchorAtEnd == null ? rangeAtEnd : anchorAtEnd || rangeAtEnd;
    setFeedAtBottom((prev) => (prev === atEnd ? prev : atEnd));
  }, [renderer]);

  const handleFeedVisibleRange = useCallback(
    (ev: EventPayload) => {
      if (typeof ev.endIndex === "number") feedRangeEndRef.current = ev.endIndex;
      refreshFeedBottom();
    },
    [refreshFeedBottom],
  );

  /** Wheel/scroll events bubbling from the feed re-check the anchor. */
  const handleFeedScroll = useCallback(() => {
    refreshFeedBottom();
  }, [refreshFeedBottom]);

  /**
   * Jump to the newest message. scrollToItem anchors on the last row: the
   * requested offset lies beyond the max scroll offset, so gpui clamps it to
   * the very end of the list. The item scroll is queued for the next render,
   * so a delayed verification falls back to a pixel scroll clamped at the
   * content end if the anchor did not reach the tail.
   */
  const scrollFeedToEnd = useCallback(() => {
    setFeedAtBottom(true);
    const id = feedListRef.current?.id;
    if (id == null || !renderer) return;
    try {
      renderer.scrollToItem?.(id, Math.max(0, feedChildCountRef.current - 1));
    } catch (e) {
      log.debug("ui.scroll", String(e));
    }
    setTimeout(() => {
      try {
        const cid = feedListRef.current?.id;
        if (cid == null) return;
        const top = renderer.getListScrollTop?.(cid);
        if (!top || top[0] < feedChildCountRef.current) {
          renderer.scrollTo?.(cid, 0, -1_000_000);
        }
        refreshFeedBottom();
      } catch (e) {
        log.debug("ui.scroll", String(e));
      }
    }, 90);
  }, [renderer, refreshFeedBottom]);

  return (
    <div
      style={{display: "flex", width: "100%", flexDirection: "row", height: "100%", minWidth: 0 }}
      onFileDrop={onDropPaths}
    >
      <div style={{display: "flex", flexGrow: 1, flexShrink: 1, minWidth: 0, flexDirection: "column", height: "100%", backgroundColor: t.bg }} onFileDrop={onDropPaths}>
        {/* topbar */}
        <div
          style={{display: "flex", 
            flexDirection: "row",
            alignItems: "center",
            gap: sp[3],
            paddingLeft: sp[5],
            paddingRight: sp[5],
            paddingTop: 10,
            paddingBottom: 10,
            borderBottomWidth: 1,
            borderColor: t.border,
            backgroundColor: t.bg,
            flexWrap: "wrap",
            width: "100%",
          }}
          onFileDrop={onDropPaths}
        >
          <PantheonRoleBadge
            badge={{ role: "goose", model: `${gooseModel.provider}/${gooseModel.model}`, cost: "MEDIUM" }}
            colors={{
              surface: t.surface,
              border: t.border,
              text: t.text,
              dim: t.dim,
              cyan: t.cyan,
              magenta: t.magenta,
          violet: t.violet,
              gold: t.gold,
            }}
            fontSize={fs.sm}
          />
          <text
            style={{
              fontSize: fs.sm,
              color: status === "ready" ? t.green : status === "error" ? t.error : t.faint,
      }}
          >
            {`${statusLabelBase(status)}${status === "ready" ? ` · ${gooseModel.model}` : ""}${streaming ? " · ответ…" : ""}`}
          </text>
          <div style={{display: "flex", flexDirection: "column",  flexGrow: 1 }} />
          {hasConversation ? (
            <div
              style={{display: "flex", 
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                  paddingLeft: 10,
                  paddingRight: 10,
                paddingTop: 4,
                paddingBottom: 4,
                borderRadius: 13,
                backgroundColor: t.glass,
                borderWidth: 1,
                borderColor: t.border,
              }}
            >
              <text style={{ fontSize: fs.xs2, color: t.text, fontWeight: 650, whiteSpace: "nowrap" }}>
                {`${fmtTokens(ctx.tokens)} ткн`}
              </text>
              {ctx.limit ? (
                <text style={{ fontSize: fs.xs2, color: t.dim, whiteSpace: "nowrap" }}>{`/ ${fmtTokens(ctx.limit)}`}</text>
              ) : null}
              {ctx.threshold != null ? (
                <text style={{ fontSize: fs.xs2, color: t.faint }}>
                  {`· автосжатие ${Math.round(ctx.threshold * 100)}%`}
                </text>
              ) : null}
              <div
                onClick={() => void compact()}
                style={{
                  paddingLeft: 9,
                  paddingRight: 9,
                  paddingTop: 3,
                  paddingBottom: 3,
                  borderRadius: 9,
                  borderWidth: 1,
                  borderColor: status === "ready" && !streaming ? t.border : "transparent",
                  cursor: status === "ready" && !streaming ? "pointer" : "default",
                  opacity: status === "ready" && !streaming ? 1 : 0.45,
                }}
              >
                <text style={{ fontSize: fs.xs2, color: t.dim }}>Сжать</text>
              </div>
            </div>
          ) : null}
        </div>

        {/* body: welcome or the virtual list */}
        {!hasConversation ? (
          <div style={{display: "flex", width: "100%", flexDirection: "column", flexGrow:1, justifyContent: "center", alignItems: "center", padding: sp[5] }} onFileDrop={onDropPaths}>
            <div style={{display: "flex", flexDirection: "column",  alignItems: "center", gap: 6 }}>
              <Clock t={t} />
              {status === "error" ? (
                <div
                  style={{display: "flex", 
                    backgroundColor: t.error + "1f",
                    borderWidth: 1,
                    borderColor: t.error,
                    borderRadius: 13,
                    padding: 10,
                    flexDirection: "row",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <text style={{ fontSize: fs.sm, color: t.text, whiteSpace: "nowrap" }}>{`⚠ ${error}`}</text>
                  <div
                    onClick={() => void connect()}
                    style={{
                      paddingLeft: 12,
                      paddingRight: 12,
                      paddingTop: 5,
                      paddingBottom: 5,
                      borderRadius: 13,
                      backgroundColor: t.gold + "33",
                      borderWidth: 1,
                      borderColor: t.gold,
                      cursor: "pointer",
                    }}
                  >
                    <text style={{ fontSize: fs.sm, color: t.text, fontWeight: 650 }}>
                      повторить подключение
                    </text>
                  </div>
                </div>
              ) : null}
              {status !== "ready" && status !== "error" ? (
                <text style={{ fontSize: fs.sm, color: t.dim }}>подключение к goose serve…</text>
              ) : null}
            </div>
          </div>
        ) : (
          <div
            style={{display: "flex", width: "100%", flexDirection: "column", flexGrow: 1, minHeight: 0, padding: sp[5], position: "relative" }}
            onFileDrop={onDropPaths}
            onScroll={handleFeedScroll}
          >
            {error ? (
              <div
                style={{
                  backgroundColor: t.error + "1f",
                  borderWidth: 1,
                  borderColor: t.error,
                  borderRadius: 13,
                  padding: 10,
                  marginBottom: sp[2],
                }}
              >
                <text style={{ fontSize: fs.sm, color: t.text, whiteSpace: "nowrap" }}>{`⚠ ${error}`}</text>
              </div>
            ) : null}
            <virtual-list
              ref={feedListRef}
              alignment="bottom"
              followTail
              estimatedItemHeight={180}
              overdraw={240}
              onVisibleRange={handleFeedVisibleRange}
              style={{display: "flex", flexDirection: "column",  flexGrow: 1, minHeight: 0, width: "100%" }}
            >
              {messageRows}
              {streaming ? (
                <div style={{display: "flex",  flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <text style={{ fontSize: fs.base, color: t.violet }}>● ● ●</text>
                </div>
              ) : null}
              {streaming ? (
                <div
                  onClick={() => sessionRef.current?.cancel()}
                  style={{display: "flex", flexDirection: "column", 
                    alignSelf: "flex-start",
                    paddingLeft: 12,
                    paddingRight: 12,
                    paddingTop: 5,
                    paddingBottom: 5,
                    borderRadius: 99,
                    borderWidth: 1,
                    borderColor: t.border,
                    cursor: "pointer",
                    marginTop: 4,
                  }}
                >
                  <text style={{ fontSize: fs.xs, color: t.dim }}>⏹ Прервать</text>
                </div>
              ) : null}
            </virtual-list>
            {/* Floating scroll-to-bottom: overlay on the feed (no nested scroll parent). */}
            {!feedAtBottom ? (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: sp[2],
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "center",
                }}
              >
                <div
                  onClick={scrollFeedToEnd}
                  style={{
                    display: "flex",
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    justifyContent: "center",
                    alignItems: "center",
                    backgroundColor: t.surface,
                    borderWidth: 1,
                    borderColor: t.border,
                    cursor: "pointer",
                    hover: { backgroundColor: t.glass, borderColor: t.magenta },
                  }}
                >
                  <text style={{ fontSize: fs.lg, color: t.magenta, fontWeight: 700 }}>↓</text>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* attachments */}
        {attachments.length > 0 && (
          <div
            onFileDrop={onDropPaths}
            style={{
              display: "flex",
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              paddingLeft: 26,
              paddingRight: 26,
              paddingBottom: 6,
            }}
          >
            {attachments.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  padding: 6,
                  borderRadius: 13,
                  backgroundColor: t.glass,
                  borderWidth: 1,
                  borderColor: a.error ? t.error : t.border,
                }}
              >
                {a.kind === "image" && a.dataUrl ? (
                  <img src={a.dataUrl} objectFit="cover" style={{ width: 56, height: 56, borderRadius: 8 }} />
                ) : (
                  <text style={{ fontSize: 22, color: t.dim, whiteSpace: "nowrap" }}>📄</text>
                )}
                <text
                  style={{
                    fontSize: fs.sm,
                    color: a.error ? t.error : t.dim,
                    whiteSpace: "nowrap",
                    maxWidth: 170,
                    textOverflow: "ellipsis",
                  }}
                >
                  {a.error || a.name}
                </text>
                <div
                  onClick={() => setAttachments((xs) => xs.filter((y) => y.id !== a.id))}
                  style={{ display: "flex", padding: 4, borderRadius: 6, cursor: "pointer" }}
                >
                  <text style={{ fontSize: fs.sm, color: t.faint }}>×</text>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* input field */}
        <div
          style={{display: "flex",
            width: "100%",
            flexDirection: "row",
            gap: sp[3],
            paddingLeft: 26,
            paddingRight: 26,
            paddingTop: sp[4],
            paddingBottom: sp[5],
            alignItems: "flex-end",
          }}
          onFileDrop={onDropPaths}
        >
          <div
            onClick={() => {
              const r = renderer as unknown as {
                promptForPaths?: (o?: { multiple?: boolean }) => Promise<string[] | null>;
              } | null;
              void r?.promptForPaths?.({ multiple: true })?.then((ps) => {
                if (ps && ps.length) void ingestPaths(ps);
              });
            }}
            style={{
              display: "flex",
              width: 44,
              height: 46,
              flexShrink: 0,
              borderRadius: 23,
              justifyContent: "center",
              alignItems: "center",
              backgroundColor: t.glass,
              borderWidth: 1,
              borderColor: t.border,
              cursor: status === "ready" ? "pointer" : "default",
              opacity: status === "ready" ? 1 : 0.5,
            }}
          >
            <Icon name="paperclip" size={16} color={t.dim} />
          </div>
          <div
            onFileDrop={onDropPaths}
            style={{
              display: "flex",
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 0,
              flexDirection: "column",
            }}
          >
            <textarea
              value={input}
              placeholder="Сообщение… (Enter — отправить)"
              minRows={1}
              maxRows={8}
              onFileDrop={onDropPaths}
              onChange={(e) => setInput(e.value ?? "")}
              onSubmit={(e) => {
                if (!e.modifiers?.shift) void send();
              }}
              style={{
                width: "100%",
                minHeight: 46,
                maxHeight: 160,
                fontSize: fs.base,
                color: t.text,
                backgroundColor: t.glass,
                borderWidth: 1,
                borderColor: t.border,
                borderRadius: 24,
                paddingLeft: 18,
                paddingRight: 18,
                paddingTop: 12,
                paddingBottom: 12,
                fontFamily: font,
              }}
            />
          </div>
          <div
            onClick={() => void send()}
            style={{ display: "flex", flexDirection: "column", 
              width: 46,
              height: 46,
              borderRadius: 23,
              justifyContent: "center",
              alignItems: "center",
              backgroundColor:
                status === "ready" && input.trim() ? t.magenta : t.glass,
              borderWidth: 1,
              borderColor: t.border,
              cursor: status === "ready" && input.trim() ? "pointer" : "default",
              opacity: status === "ready" && input.trim() ? 1 : 0.5,
            }}
          >
            <Icon
              name="send"
              size={18}
              color={status === "ready" && input.trim() ? "#1a1330" : t.faint}
            />
          </div>
        </div>

        <UsageBar t={t} refreshKey={messages.length} />
      </div>

      {/* right panel: todos + subagents */}
      {hasConversation ? (
      <div
        style={{
          display: "flex",
          width: props.railWidth,
          minWidth: props.railWidth,
          borderLeftWidth: 1,
          paddingTop: sp[4],
          paddingBottom: sp[4],
          paddingLeft: sp[3],
          paddingRight: sp[3],
          backgroundColor: t.bg,
        flexDirection: "column",
          gap: sp[3],
          position: "relative",
        }}
      >
        <div
          onMouseDown={railDrag.onMouseDown}
          onMouseMove={railDrag.onMouseMove}
          onMouseUp={railDrag.onMouseUp}
          style={{
            position: "absolute",
            top: 0,
            left: -3,
            bottom: 0,
            width: 6,
            cursor: "col-resize",
          }}
        />
        {todos ? (
          <div
            style={{ display: "flex", 
              backgroundColor: t.surface,
              borderWidth: 1,
              borderColor: t.border,
              borderRadius: 17,
              padding: sp[3],
              flexDirection: "column",
            }}
          >
            <text
              style={{
                fontSize: fs.xs2,
                color: t.faint,
                fontWeight: 650,
                marginBottom: sp[3],
              }}
            >
              ЗАДАЧИ
            </text>
            <div style={{display: "flex",  flexDirection: "column", gap: 2 }}>
              {todos.map((td, i) => {
                const [title, detail] = td.content.split(" — ");
                return (
                  <div key={i} style={{display: "flex",  flexDirection: "row", gap: 9, padding: 6 }}>
                    <div
                      style={{ display: "flex", flexDirection: "column", 
                        width: 16,
                        height: 16,
                        borderRadius: 5,
                        borderWidth: 1.5,
                        borderColor:
                          td.status === "completed"
                            ? t.green
                            : td.status === "in_progress"
                              ? t.cyan
                              : t.border,
                        backgroundColor:
                          td.status === "completed" ? t.green : t.glass,
                        justifyContent: "center",
                        alignItems: "center",
                      }}
                    >
                      <text
                        style={{
                          fontSize: 10,
                          color: td.status === "completed" ? t.bg : t.dim,
                        }}
                      >
                        {td.status === "completed" ? "✓" : td.status === "in_progress" ? "·" : ""}
                      </text>
                    </div>
                    <div style={{display: "flex",  flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
                      <text style={{ fontSize: fs.sm, color: t.dim }}>{title}</text>
                      {detail ? (
                        <text style={{ fontSize: fs.xs2, color: t.faint }}>{detail}</text>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {subagents.length > 0 ? (
          <div
            style={{display: "flex", 
              backgroundColor: t.surface,
              borderWidth: 1,
              borderColor: t.border,
              borderRadius: 17,
              padding: sp[3],
              flexDirection: "column",
            }}
          >
            <text style={{ fontSize: fs.xs2, color: t.faint, fontWeight: 650, marginBottom: sp[3] }}>
              {`СУБАГЕНТЫ${running ? ` · ${running} активн.` : ""}`}
            </text>
            <div style={{display: "flex",  flexDirection: "column", gap: 2 }}>
              {subagents.map((s) => (
                <div key={s.id} style={{display: "flex",  flexDirection: "row", alignItems: "center", gap: 7 }}>
                  <div
                    style={{ display: "flex", flexDirection: "column", 
                      width: 7,
                      height: 7,
                      borderRadius: 4,
                      backgroundColor: s.running ? t.green : t.faint,
                      flexShrink: 0,
                    }}
                  />
                  <div
                    onClick={() => props.onOpenSubagent(s.id)}
                    style={{display: "flex", flexDirection: "column",  flexGrow: 1, minWidth: 0, cursor: "pointer", padding: 3 }}
                  >
                    <text
                      style={{
                        fontSize: fs.sm,
                        color: t.text,
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.label}
                    </text>
                  </div>
                  <text style={{ fontSize: fs.xs, color: t.faint }}>
                    {`${s.tokens.toLocaleString("ru")} ткн`}
                  </text>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}

export default ChatPage;
