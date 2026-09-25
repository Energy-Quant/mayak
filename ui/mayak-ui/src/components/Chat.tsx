/**
 * Chat — ACP-чат на GPUIX (порт Chat.tsx rev14 без Tauri/DOM/webview).
 * Ключи GPUIX: <virtual-list alignment="bottom" followTail>, <markdown> host,
 * expandable preview+Show more (без inner scroll), pointer-capture resize.
 * Вложения (Ctrl+V/DnD/picker) — шаг 8; события заменены на пропсы App.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AcpSession,
  listSubagents,
  errText,
  type ChatMessage,
  type SubagentRow,
  type TodoItem,
} from "../acp";
import { getConfigSummary, getConfigLimits } from "../api/config";
import { getProviderCatalog } from "../api/catalog";
import { listSessions } from "../api/db";
import { copyText } from "../api/clipboard";
import PantheonRoleBadge from "./PantheonRoleBadge";
import { Icon } from "./Icon";
import { useDragWidth } from "../useDragWidth";
import UsageBar from "./UsageBar";
import { Markdown, UserText } from "./md";
import { ToolBody, type ToolTheme } from "./toolRender";
import { fs, font, sp, type WaveTheme } from "../tokens";

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

function statusLabel(s: string) {
  return (
    { idle: "не подключено", starting: "подключение…", ready: "готов · glm-5.3-flash", error: "ошибка" }[
      s
    ] ?? s
  );
}

/** Свёрнутое/раскрытое тело: preview + Show more (outer list скроллит) */
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
            ? {display: "flex",  overflow: "hidden", flexDirection: "column", minWidth: 0 }
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

/** Плавная пульсация (sin): active → opacity 0.35..1, иначе 1 */
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
/** Braille-спиннер для долгих инструментов */
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
  // thinking «в работе» = стрим + это последнее (вспыхивает только свежая цепочка)
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
          backgroundColor: t.surface,
          borderWidth: 1,
          borderLeftWidth: 3,
          borderColor: thinkingActive ? t.violet : t.border,
          borderRadius: 13,
          padding: 10,
          maxWidth: "96%",
          width: "96%",
          flexDirection: "column",
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
          <div style={{ display: "flex", width: "100%", flexDirection: "column", marginTop: 8 }}>
            <Markdown source={m.text ?? ""} t={t} />
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
            flexDirection: "column",
            minWidth: 0,
            position: "relative",
            backgroundColor: t.userBubble,
            borderTopRightRadius: 24,
            borderBottomRightRadius: 6,
            borderBottomLeftRadius: 24,
            borderTopLeftRadius: 24,
            paddingLeft: 15,
            paddingRight: 34,
            paddingTop: 10,
            paddingBottom: 10,
          }}
        >
          <UserText text={m.text ?? ""} t={t} fontSize={fs.base} />
          <div style={{ position: "absolute", top: 8, right: 8 }}>
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
        paddingLeft: 15,
        paddingRight: 34,
        paddingTop: 10,
        paddingBottom: 10,
      }}
    >
      <Markdown source={m.text ?? ""} t={t} />
      <div style={{ position: "absolute", top: 8, right: 8 }}>
        <CopyBtn text={copySrc} t={t} />
      </div>
    </div>
  );
});

export function ChatPage(props: {
  railWidth: number;
  onRailWidth: (w: number) => void;
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
  const sessionRef = useRef<AcpSession | null>(null);
  const startedRef = useRef(false);

  const makeSession = () =>
    new AcpSession({
      onMessage: (m) =>
        setMessages((ms) => {
          const last = ms[ms.length - 1];
          // Стрим: каждый chunk — продолжение предыдущего (роль та же, chunk=true)
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
      onReady: () => setStatus("ready"),
      onError: (e) => {
        setError(e);
        setStatus("error");
      },
    });

  const connect = useCallback(async () => {
    sessionRef.current?.stop();
    setError("");
    setStatus("starting");
    const s = makeSession();
    sessionRef.current = s;
    try {
      await s.start();
    } catch (e) {
      setError(errText(e).slice(0, 200));
      setStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // автоподключение
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void connect();
    return () => sessionRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // открытие сессии из Истории/сайдбара (проп от App — без window-событий)
  useEffect(() => {
    if (!props.pendingSession) return;
    const id = props.pendingSession;
    props.clearPending();
    const run = async () => {
      sessionRef.current?.stop();
      setMessages([]);
      setTodos(null);
      setSubagents([]);
      setError("");
      setStatus("starting");
      const s = makeSession();
      sessionRef.current = s;
      try {
        await s.load(id);
      } catch (e) {
        setError(`Не удалось открыть сессию: ${errText(e).slice(0, 160)}`);
        setStatus("error");
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pendingSession]);

  // лимиты контекста + порог автосжатия
  useEffect(() => {
    const load = async () => {
      try {
        const cat = await getProviderCatalog();
        const models = cat.models_by_provider["opencode_go"] ?? [];
        const m = models.find((x) => x.name === "glm-5.3-flash") ?? models[0];
        let c: { goose_auto_compact_threshold: number | null } | null = null;
        try {
          c = getConfigLimits();
        } catch {
          c = null;
        }
        setCtx((v) => ({
          ...v,
          limit: m?.context_limit ?? null,
          threshold: c?.goose_auto_compact_threshold ?? null,
        }));
      } catch {
        /* каталог недоступен — метр без limit */
      }
    };
    void load();
  }, []);

  // токены текущей сессии + субагенты: poll
  useEffect(() => {
    const sid = sessionRef.current?.id;
    if (!sid) {
      setCtx((c) => ({ ...c, tokens: 0 }));
      setSubagents([]);
      return;
    }
    const poll = () => {
      try {
        const row = listSessions(false).find((r) => r.id === sid);
        if (row) setCtx((c) => ({ ...c, tokens: row.total_tokens ?? 0 }));
        setSubagents(listSubagents(sid));
      } catch {
        /* тихо */
      }
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, status]);

  const compact = async () => {
    if (!sessionRef.current || status !== "ready") return;
    setStreaming(true);
    try {
      await sessionRef.current.prompt("/compact");
    } catch (e) {
      setError(`Сжатие: ${errText(e).slice(0, 120)}`);
    } finally {
      setStreaming(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !sessionRef.current || status !== "ready") return;
    setInput("");
    setStreaming(true);
    try {
      await sessionRef.current.prompt(text);
    } catch (e) {
      setError(`Ошибка промпта: ${errText(e).slice(0, 200)}`);
    } finally {
      setStreaming(false);
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

  return (
    <div style={{display: "flex",  flexDirection: "row", height: "100%", flexGrow: 1, minWidth: 0 }}>
      <div style={{display: "flex",  flexDirection: "column", flexGrow: 1, minWidth: 0, height: "100%" }}>
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
            backgroundColor: t.bg,
          }}
        >
          <PantheonRoleBadge
            badge={{ role: "goose", model: "opencode_go/glm-5.3-flash", cost: "MEDIUM" }}
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
            {statusLabel(status)}
            {streaming ? " · ответ…" : ""}
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
              <text style={{ fontSize: fs.xs2, color: t.text, fontWeight: 650 }}>
                {fmtTokens(ctx.tokens)} ткн
              </text>
              {ctx.limit ? (
                <text style={{ fontSize: fs.xs2, color: t.dim }}>/ {fmtTokens(ctx.limit)}</text>
              ) : null}
              {ctx.threshold != null ? (
                <text style={{ fontSize: fs.xs2, color: t.faint }}>
                  · автосжатие {Math.round(ctx.threshold * 100)}%
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

        {/* тело: welcome или виртуальный список */}
        {!hasConversation ? (
          <div style={{display: "flex", flexDirection: "column",  flexGrow:1, justifyContent: "center", alignItems: "center", padding: sp[5] }}>
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
                  <text style={{ fontSize: fs.sm, color: t.text }}>⚠ {error}</text>
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
          <div style={{display: "flex",  flexDirection: "column", flexGrow: 1, minHeight: 0, padding: sp[5] }}>
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
                <text style={{ fontSize: fs.sm, color: t.text }}>⚠ {error}</text>
              </div>
            ) : null}
            <virtual-list
              alignment="bottom"
              followTail
              estimatedItemHeight={180}
              overdraw={240}
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
          </div>
        )}

        {/* поле ввода */}
        <div
          style={{display: "flex", 
            flexDirection: "row",
            gap: sp[3],
            paddingLeft: 26,
            paddingRight: 26,
            paddingTop: sp[4],
            paddingBottom: sp[5],
            alignItems: "flex-end",
          }}
        >
          <textarea
            value={input}
            placeholder="Сообщение… (Enter — отправить)"
            minRows={1}
            maxRows={8}
            onChange={(e) => setInput(e.value ?? "")}
            onSubmit={(e) => {
              if (!e.modifiers?.shift) void send();
            }}
            style={{display: "flex", flexDirection: "column", 
              flexGrow: 1,
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

      {/* правая панель: задачи + субагенты */}
      <div
        style={{
          display: hasConversation ? "flex" : "none",
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
              СУБАГЕНТЫ{running ? ` · ${running} активн.` : ""}
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
                    {s.tokens.toLocaleString("ru")} ткн
                  </text>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ChatPage;
