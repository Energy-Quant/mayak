/**
 * SubagentStream — split-view live-вид субагента из sessions.db (опрос 2с).
 * virtual-list (отдельная колонка — НЕ nested scroll), markdown host-элемент,
 * структурированные tool-call, expandable thinking/text (preview + Show more).
 */
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { listSubagentMessages, type SubagentMessage, type ContentBlock } from "../api/db";
import { copyText } from "../api/clipboard";
import { ToolBody, type ToolTheme } from "./toolRender";
import { fs, type WaveTheme } from "../tokens";
import { Markdown, italicize } from "./md";

function roleLabel(role: string, isFirstUser: boolean): string {
  if (role === "user") return isFirstUser ? "Задача" : "Ход";
  if (role === "assistant") return "Ответ";
  if (role === "tool") return "Инструмент";
  return role;
}

/** Свёрнутое тело → кнопка → раскрытие (без inner scroll — outer list скроллит) */
function Expandable(props: {
  children: ReactNode;
  t: WaveTheme;
  collapsed: number;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{display: "flex",  flexDirection: "column", gap: 4, minWidth: 0, flexGrow: 1 }}>
      <div
        style={
          open
            ? {display: "flex",  overflow: "hidden", flexDirection: "column", minWidth: 0 }
            : {display: "flex",  maxHeight: props.collapsed, overflow: "hidden", flexDirection: "column", minWidth: 0 }
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
          {open ? "▲ Свернуть" : `▼ ${props.label}`}
        </text>
      </div>
    </div>
  );
}

function CopyBtn(props: { text: string; t: WaveTheme }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    copyText(props.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [props.text]);
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
        borderColor: props.t.border,
        cursor: "pointer",
        opacity: 0.7,
      }}
    >
      <text style={{ fontSize: fs.xs, color: copied ? props.t.green : props.t.faint }}>
        {copied ? "✓" : "⧉"}
      </text>
    </div>
  );
}

/** Thinking: скрыт по умолчанию — только заголовок, клик раскрывает (паритет чата) */
const ThinkingRow = memo(function ThinkingRow(props: { text: string; t: WaveTheme }) {
  const [open, setOpen] = useState(false);
  const t = props.t;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
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
            backgroundColor: open ? t.violet : t.faint,
            flexShrink: 0,
          }}
        />
        <text style={{ fontSize: fs.xs2, color: t.faint, fontWeight: 650 }}>Thinking</text>
        <text style={{ fontSize: fs.xs2, color: t.faint, opacity: 0.8 }}>
          {open ? "▴ свернуть" : "▸ показать"}
        </text>
      </div>
      {open ? <Markdown source={italicize(props.text)} t={t} /> : null}
    </div>
  );
});

const SubMsg = memo(function SubMsg(props: {
  m: SubagentMessage;
  isFirstUser: boolean;
  t: WaveTheme;
}) {
  const { m, t } = props;
  const label = roleLabel(m.role, props.isFirstUser);
  const blocks: ContentBlock[] = useMemo(
    () => (m.blocks?.length ? m.blocks : [{ kind: "text", text: m.content }]),
    [m.blocks, m.content],
  );
  const fullText = useMemo(
    () =>
      blocks
        .filter((b) => b.kind === "text" || b.kind === "thinking")
        .map((b) => b.text)
        .join("\n\n") || m.content,
    [blocks, m.content],
  );
  const th: ToolTheme = {
    dim: t.dim,
    faint: t.faint,
    text: t.text,
    cyan: t.cyan,
    magenta: t.magenta,
    green: t.green,
    gold: t.gold,
    glass: t.glass,
    border: t.border,
  };

  return (
    <div
      style={{display: "flex", 
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: t.border,
        borderRadius: 13,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 10,
        marginBottom: 8,
        borderLeftWidth: 3,
        flexDirection: "column",
        minWidth: 0,
}}
    >
      <div
        style={{display: "flex", 
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
         marginBottom: 5,
        }}
      >
        <text style={{ fontSize: fs.xs2, color: t.faint, fontWeight: 650 }}>{label}</text>
        <CopyBtn text={fullText} t={t} />
      </div>
  <div style={{display: "flex",  flexDirection: "column", gap: 6, minWidth: 0 }}>
        {blocks.map((b, j) => {
          if (b.kind === "thinking") {
            return <ThinkingRow key={j} text={b.text} t={t} />;
          }
          if (b.kind === "tool" || b.kind === "tool_out") {
            return (
              <div
                key={j}
                style={{ display: "flex", 
                  flexDirection: "row",
                  gap: 6,
                  backgroundColor: t.glass,
                  borderRadius: 9,
                  paddingLeft: 8,
                  paddingRight: 8,
                  paddingTop: 4,
                  paddingBottom: 4,
                  opacity: b.kind === "tool_out" ? 0.75 : 1,
                  minWidth: 0,
                }}
              >
                <text style={{ fontSize: fs.xs, color: t.dim }}>{b.kind === "tool" ? "⚙" : "←"}</text>
                <div style={{display: "flex", flexDirection: "column",  flexGrow: 1, minWidth: 0 }}>
                  <ToolBody
                    toolName={b.kind === "tool" ? b.text.split(" ")[0] : "output"}
                    rawText={b.text}
                    theme={th}
                  />
                </div>
              </div>
            );
          }
          if (b.kind === "image") {
            return (
              <text key={j} style={{ fontSize: fs.xs, color: t.dim }}>
                🖼 {b.text}
              </text>
            );
          }
          return (
            <Expandable key={j} t={t} collapsed={220} label="Показать полностью">
              <Markdown source={b.text} t={t} />
            </Expandable>
          );
        })}
      </div>
    </div>
  );
});

export default function SubagentStream(props: { sessionId: string; t: WaveTheme }) {
  const { sessionId, t } = props;
  const [msgs, setMsgs] = useState<SubagentMessage[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () => {
      try {
        const rows = listSubagentMessages(sessionId);
        if (alive) {
          setErr("");
          setMsgs(rows);
        }
      } catch (e) {
        if (alive) setErr(String(e).slice(0, 160));
      }
    };
    load();
    const iv = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [sessionId]);

  let seenUser = false;
  const rows = msgs.map((m, i) => {
    const isFirstUser = m.role === "user" && !seenUser;
    if (m.role === "user") seenUser = true;
    return { m, isFirstUser, key: i };
  });

  if (rows.length === 0) {
    return (
      <div style={{ display: "flex",  flexDirection:"column", padding: 16, gap: 8 }}>
        {err ? (
          <text style={{ fontSize: fs.sm, color: t.error, whiteSpace: "nowrap" }}>{`⚠ ${err}`}</text>
        ) : (
          <text style={{ fontSize: fs.sm, color: t.faint }}>
            {err ? `⚠ ${err}` : "Ждём сообщения субагента…"}
          </text>
        )}
      </div>
    );
  }

  return (
    <virtual-list
      alignment="bottom"
      followTail
      estimatedItemHeight={160}
      overdraw={240}
      style={{display: "flex", flexDirection: "column",  flexGrow: 1, minHeight: 0, width: "100%" }}
    >
      {rows.map((r) => (
        <SubMsg key={r.key} m={r.m} isFirstUser={r.isFirstUser} t={t} />
      ))}
    </virtual-list>
  );
}
