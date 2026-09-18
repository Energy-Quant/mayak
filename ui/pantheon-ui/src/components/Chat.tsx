// Chat — ACP-чат + правая панель: TODO (динамически из session/update) + субагенты (sessions.db)
import { useEffect, useRef, useState } from "react";
import { AcpSession, ChatMessage, TodoItem, SubagentRow, listSubagents } from "../acp";
import PantheonRoleBadge from "./PantheonRoleBadge";
import { Icon } from "./Icon";

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [todos, setTodos] = useState<TodoItem[] | null>(null);
  const [subagents, setSubagents] = useState<SubagentRow[]>([]);
  const [status, setStatus] = useState<"idle" | "starting" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<AcpSession | null>(null);

  // автоскролл
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [messages.length]);

  // субагенты: только для активного разговора (после первого сообщения) — появляется динамически
  const hasConversation = messages.length > 0;
  useEffect(() => {
    if (!hasConversation) { setSubagents([]); return; }
    const load = () => listSubagents().then(setSubagents).catch(() => setSubagents([]));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [hasConversation]);

  const connect = async () => {
    setError("");
    setStatus("starting");
    const s = new AcpSession({
      onMessage: (m) => setMessages((ms) => [...ms.slice(-400), m]),
      onUpdateMessage: (id, patch) =>
        setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m))),
      onTodo: (items) => setTodos(items.length ? items : null),
      onReady: () => setStatus("ready"),
      onError: (e) => { setError(e); setStatus("error"); },
    });
    sessionRef.current = s;
    try { await s.start(); } catch (e) { setError(String(e).slice(0, 120)); setStatus("error"); }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !sessionRef.current || status !== "ready") return;
    setInput("");
    try { await sessionRef.current.prompt(text); }
    catch (e) { setError(String(e).slice(0, 120)); }
  };

  useEffect(() => () => sessionRef.current?.stop(), []);

  const running = subagents.filter((s) => s.running).length;

  return (
    <div className="chat-page">
      <div className="chat-col">
        <header className="topbar">
          <PantheonRoleBadge role="goose" model="opencode_go/glm-5.3-flash" cost="MEDIUM" />
          <span className={`chat-state ${status}`}>{statusLabel(status)}</span>
        </header>
        <div className="chat-scroll" ref={scrollerRef}>
          {hasConversation === false && (
            <div className="chat-center">
              <div className="chat-hero">
                <div className="chat-placeholder-icon"><Icon name="goose" size={44} /></div>
                {status === "idle" ? (
                  <>
                    <button className="primary" onClick={connect}>Подключить goose serve (ACP)</button>
                    <div className="dim small">после подключения панель задач и субагентов появится справа</div>
                  </>
                ) : (
                  <>
                    <div>Готов. Начните разговор.</div>
                    <div className="dim small">панель задач и субагентов появится справа</div>
                  </>
                )}
              </div>
            </div>
          )}
          {error && <div className="error-banner">⚠ {error}</div>}
          <MessageList messages={messages} onSubagent={(id) => window.dispatchEvent(new CustomEvent("open-subagent", { detail: id }))} />
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
      </div>

      <aside className="chat-right" style={{ display: hasConversation ? undefined : "none" }}>
        {todos && (
          <section className="rail-card">
            <h3><Icon name="clipboard" /> Задачи</h3>
            <ul className="todo-list">
              {todos.map((t, i) => (
                <li key={i} className={`todo-${t.status}`}>
                  <span className="todo-box">{t.status === "completed" ? "✓" : ""}</span>
                  {t.content}
                </li>
              ))}
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

function MessageList(props: { messages: ChatMessage[]; onSubagent: (id: string) => void }) {
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
              <div className="tool-body">{m.text.slice(0, 400)}</div>
            </div>
          ) : (
            <div className="bubble">{m.text}</div>
          )}
        </div>
      ))}
    </>
  );
}
