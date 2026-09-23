// Chat — ACP-чат: автостарт goose serve + welcome-экран; субагенты — иерархия внутри сессии
import { useEffect, useRef, useState } from "react";
import { AcpSession, ChatMessage, TodoItem, SubagentRow, listSubagents } from "../acp";
import { renderMarkdown, renderUserText } from "../markdown";
import PantheonRoleBadge from "./PantheonRoleBadge";
import { Icon } from "./Icon";
import { useDragWidth } from "../useDragWidth";
import UsageBar from "./UsageBar";

function greeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Доброе утро";
  if (h >= 12 && h < 18) return "Добрый день";
  if (h >= 18 && h < 23) return "Добрый вечер";
  return "Доброй ночи";
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="hero-clock">
      <div className="hero-time">
        {now.getHours().toString().padStart(2, "0")}:{now.getMinutes().toString().padStart(2, "0")}
      </div>
      <div className="hero-greeting">{greeting()}</div>
    </div>
  );
}

export function ChatPage(props: { railWidth: number; onRailWidth: (w: number) => void }) {
  const startRailResize = useDragWidth(() => props.railWidth, props.onRailWidth, {
    min: 210, max: 480, invert: true,
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [todos, setTodos] = useState<TodoItem[] | null>(null);
  const [subagents, setSubagents] = useState<SubagentRow[]>([]);
  const [status, setStatus] = useState<"idle" | "starting" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<AcpSession | null>(null);
  const startedRef = useRef(false);

  // автоскролл
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [messages.length]);

  const connect = async () => {
    setError("");
    setStatus("starting");
    const s = new AcpSession({
      onMessage: (m) =>
        setMessages((ms) => {
          const last = ms[ms.length - 1];
          // Стрим: каждый agent_message_chunk — не новое сообщение, а продолжение
          // предыдущего чанка-сообщения (пока не было tool/user — они разрывают цепочку)
          if (m.role === "agent" && last?.role === "agent" && last.chunk) {
            return [...ms.slice(0, -1), { ...last, text: last.text + m.text }];
          }
          const msg: ChatMessage = m.role === "agent" ? { ...m, chunk: true } : m;
          return [...ms.slice(-400), msg];
        }),
      onUpdateMessage: (id, patch) =>
        setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m))),
      onTodo: (items) => setTodos(items.length ? items : null),
      onReady: () => setStatus("ready"),
      onError: (e) => { setError(e); setStatus("error"); },
    });
    sessionRef.current = s;
    try { await s.start(); } catch (e) { setError(String(e).slice(0, 120)); setStatus("error"); }
  };

  // автоподключение: стартовый экран сразу готов к вводу, без ручной кнопки
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    connect();
    return () => sessionRef.current?.stop();
  }, []);

  // иерархия: субагенты ТОЛЬКО текущей сессии (children), не глобальный список
  useEffect(() => {
    const parent = sessionRef.current?.id;
    if (!parent) { setSubagents([]); return; }
    const load = () => listSubagents(parent).then(setSubagents).catch(() => setSubagents([]));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [status === "ready", messages.length]);

  const send = async () => {
    const text = input.trim();
    if (!text || !sessionRef.current || status !== "ready") return;
    setInput("");
    setStreaming(true);
    try { await sessionRef.current.prompt(text); }
    catch (e) { setError(`Ошибка промпта: ${String(e).slice(0, 200)}`); }
    finally { setStreaming(false); }
  };

  useEffect(() => () => sessionRef.current?.stop(), []);

  const running = subagents.filter((s) => s.running).length;
  const hasConversation = messages.length > 0;

  return (
    <div className="chat-page">
      <div className="chat-col">
        <header className="topbar">
          <PantheonRoleBadge role="goose" model="opencode_go/glm-5.3-flash" cost="MEDIUM" />
          <span className={`chat-state ${status}`}>{statusLabel(status)}{streaming && " · ответ…"}</span>
        </header>
        <div className="chat-scroll" ref={scrollerRef}>
          {hasConversation === false && (
            <div className="chat-center">
              <div className="chat-hero">
                <Clock />
                {status === "error" && (
                  <div className="error-banner">
                    ⚠ {error}{" "}
                    <button className="primary" onClick={connect}>повторить подключение</button>
                  </div>
                )}
                {status !== "ready" && status !== "error" && (
                  <div className="dim small">подключение к goose serve…</div>
                )}
              </div>
            </div>
          )}
          {error && hasConversation && <div className="error-banner">⚠ {error}</div>}
          <MessageList messages={messages} streaming={streaming} onSubagent={(id) => window.dispatchEvent(new CustomEvent("open-subagent", { detail: id }))} onCancel={() => sessionRef.current?.cancel()} />
        </div>
        <div className="chat-input-row">
          <textarea
            className="chat-input"
            placeholder="Сообщение… (Enter — отправить, Shift+Enter — перенос)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            disabled={status !== "ready"}
          />
          <button className="primary" disabled={status !== "ready" || !input.trim()} onClick={send}>→</button>
        </div>
        <UsageBar refreshKey={messages.length} />
      </div>

      <aside
        className="chat-right"
        style={{ display: hasConversation ? undefined : "none", width: props.railWidth, minWidth: props.railWidth }}
      >
        <div className="resize-handle" onMouseDown={startRailResize} title="Потянуть — изменить ширину" />
        {todos && (
          <section className="rail-card">
            <h3><Icon name="clipboard" /> Задачи</h3>
            <ul className="todo-list">
              {todos.map((t, i) => {
                const [title, detail] = t.content.split(" — ");
                return (
                  <li key={i} className={`todo-${t.status}`}>
                    <span className="todo-box">{t.status === "completed" ? "✓" : t.status === "in_progress" ? "·" : ""}</span>
                    <span className="todo-text">
                      {title}
                      {detail && <span className="todo-detail">{detail}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {subagents.length > 0 && (
          <section className="rail-card">
            <h3><Icon name="puzzle" /> Субагенты{running ? ` · ${running} активн.` : ""}</h3>
            <ul className="subagent-list">
              {subagents.map((s) => (
                <li key={s.id}>
                  <span className={`chat-dot${s.running ? " on" : ""}`} />
                  <button className="subagent-name" onClick={() => window.dispatchEvent(new CustomEvent("open-subagent", { detail: s.id }))}>
                    {s.label}
                  </button>
                  <span className="dim small">{s.tokens.toLocaleString("ru")} ткн</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

function statusLabel(s: string) {
  return { idle: "не подключено", starting: "подключение…", ready: "готов · glm-5.3-flash", error: "ошибка" }[s] ?? s;
}

function MessageList(props: { messages: ChatMessage[]; streaming: boolean; onSubagent: (id: string) => void; onCancel: () => void }) {
  return (
    <>
      {props.messages.map((m, i) => (
        <div key={m.id + i} className={`msg msg-${m.role}`}>
          {m.role === "tool" ? (
            <div className={`tool-call tool-${m.toolStatus ?? "completed"}`}>
              <span className="tool-icon"><Icon name="app" size={13} /></span>
              <span className="tool-name">{m.toolName}</span>
              {m.subagentSessionId && (
                <button className="tool-subagent" onClick={() => props.onSubagent(m.subagentSessionId!)}>
                  ↗ {m.subagentSessionId}
                </button>
              )}
              <div className="tool-body">{(m.text ?? "").slice(0, 400)}</div>
            </div>
          ) : (
            <div
              className={`bubble ${m.role === "user" ? "user-text" : "md-body"}`}
              dangerouslySetInnerHTML={{
                __html: m.role === "user" ? renderUserText(m.text ?? "") : renderMarkdown(m.text ?? ""),
              }}
            />
          )}
        </div>
      ))}
      {props.streaming && (
        <div className={`msg msg-agent streaming`}>
          <div className="bubble"><span className="dots"><i /><i /><i /></span></div>
        </div>
      )}
      {props.streaming && (
        <button className="cancel-btn" onClick={props.onCancel}>⏹ Прервать</button>
      )}
    </>
  );
}

export default ChatPage;
