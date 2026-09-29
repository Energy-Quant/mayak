// SubagentStream — split-view live-вид субагента из sessions.db (опрос 2с).
// Рендер: markdown, структурированные tool-call, полное раскрытие thinking/вывода,
// кнопка копирования на каждое сообщение.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri, safeInvoke, errText } from "../acp";
import { renderMarkdown } from "../markdown";
import { renderToolBody } from "../toolRender";

interface Block {
  kind: "text" | "thinking" | "tool" | "tool_out" | "image" | string;
  text: string;
}

interface Msg {
  role: string;
  content: string;
  blocks?: Block[];
}

function roleLabel(role: string, isFirstUser: boolean): string {
  if (role === "user") return isFirstUser ? "Задача" : "Ход";
  if (role === "assistant") return "Ответ";
  if (role === "tool") return "Инструмент";
  return role;
}

/** Копирование в буфер (с fallback для WebKitGTK) */
function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text: string): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch { /* ignore */ }
  document.body.removeChild(ta);
}

/** Свёрнутое тело → кнопка → полное раскрытие со скроллом */
function ExpandableHtml(props: {
  html: string;
  className?: string;
  collapsed?: number;
  label?: string;
}) {
  const { html, className = "", collapsed = 200, label = "Раскрыть полностью" } = props;
  const [open, setOpen] = useState(false);
  return (
    <div className={`xbody ${open ? "open" : ""} ${className}`}>
      <div
        className="xbody-inner"
        style={open ? undefined : { maxHeight: collapsed }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <button type="button" className="xbody-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▲ Свернуть" : `▼ ${label}`}
      </button>
    </div>
  );
}

/** Одно сообщение субагента */
const SubMsg = function SubMsg(props: { m: Msg; index: number; isFirstUser: boolean }) {
  const { m, isFirstUser } = props;
  const [copied, setCopied] = useState(false);
  const label = roleLabel(m.role, isFirstUser);

  const blocks = useMemo(() => {
    return m.blocks?.length ? m.blocks : ([{ kind: "text", text: m.content }] as Block[]);
  }, [m.blocks, m.content]);

  // полный текст сообщения для копирования
  const fullText = useMemo(
    () => blocks.filter((b) => b.kind === "text" || b.kind === "thinking").map((b) => b.text).join("\n\n") || m.content,
    [blocks, m.content],
  );

  const copy = useCallback(() => {
    copyText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [fullText]);

  return (
    <div className={`subagent-msg role-${m.role}`}>
      <div className="subagent-head">
        <span className="subagent-role">{label}</span>
        <button className="msg-copy" onClick={copy} title="Копировать сообщение">
          {copied ? "✓" : "⧉"}
        </button>
      </div>
      <div className="subagent-body">
        {blocks.map((b, j) => {
          if (b.kind === "thinking") {
            const html = renderMarkdown(b.text);
            return (
              <div key={j} className="subagent-thinking">
                <div className="think-label">💭 Рассуждения</div>
                <ExpandableHtml html={html} collapsed={72} label="Показать цепочку мышления" />
              </div>
            );
          }
          if (b.kind === "tool" || b.kind === "tool_out") {
            const html = renderToolBody(b.kind === "tool" ? b.text.split(" ")[0] : "output", b.text);
            return (
              <div key={j} className={`subagent-tool ${b.kind === "tool" ? "tool-in" : "tool-out"}`}>
                <span className="tool-kind">{b.kind === "tool" ? "⚙" : "←"}</span>
                <div className="subagent-tool-body" dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            );
          }
          if (b.kind === "image") {
            return <div key={j} className="subagent-tool">🖼 {b.text}</div>;
          }
          // текст (вывод) — markdown + раскрытие
          return (
            <ExpandableHtml
              key={j}
              html={renderMarkdown(b.text)}
              className="subagent-text md-body"
              collapsed={220}
              label="Показать полностью"
            />
          );
        })}
      </div>
    </div>
  );
};

export default function SubagentStream({ sessionId }: { sessionId: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [err, setErr] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!isTauri()) { setErr("не в Tauri"); return; }
      try {
        const rows = await safeInvoke<Msg[]>("list_subagent_messages", { sessionId });
        if (alive) {
          setErr("");
          setMsgs(rows);
        }
      } catch (e) {
        if (alive) setErr(errText(e).slice(0, 160));
      }
    };
    void load();
    const t = setInterval(() => { void load(); }, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [sessionId]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [msgs.length]);

  let seenUser = false;

  return (
    <div className="subagent-stream" ref={boxRef}>
      {err && <div className="error-banner">⚠ {err}</div>}
      {msgs.map((m, i) => {
        const isFirstUser = m.role === "user" && !seenUser;
        if (m.role === "user") seenUser = true;
        return <SubMsg key={i} m={m} index={i} isFirstUser={isFirstUser} />;
      })}
      {msgs.length === 0 && !err && (
        <div className="dim small">Ждём сообщения субагента…</div>
      )}
    </div>
  );
}
