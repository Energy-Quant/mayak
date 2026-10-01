/**
 * toolRender.tsx — structured rendering of tool-call bodies (port of toolRender.ts without HTML).
 * GPUIX has no dangerouslySetInnerHTML — we return React nodes (<text>/<div>).
 */
import type { ReactNode } from "react";
import { parseTodos } from "../acp";
import { fs } from "../tokens";
import { log } from "../logger";

const clip = (s: string, n: number) =>
  s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "…";

/** Single-line safe text */
const one = (s: string) => s.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();

function tryParse(raw: string): Record<string, unknown> | null {
  const t = (raw ?? "").trim();
  if (!t.startsWith("{")) return null;
  try {
    const p = JSON.parse(t);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
  } catch (e) { log.debug("ui.error", String(e));
    return null;
  }
}

export interface ToolTheme {
  dim: string;
  faint: string;
  text: string;
  cyan: string;
  magenta: string;
  green: string;
  gold: string;
  glass: string;
  border: string;
}

/** Todo checklist */
function TodoList({ content, raw, th }: { content?: string; raw: string; th: ToolTheme }) {
  const items = parseTodos(content ?? raw);
  if (!items.length) return null;
  return (
    <div style={{display: "flex",  flexDirection: "column", gap: 3 }}>
      {items.map((i, k) => (
        <div key={k} style={{display: "flex",  flexDirection: "row", gap: 8 }}>
          <text
            style={{
              fontSize: fs.xs,
              width: 14,
              color: i.status === "completed" ? th.green : i.status === "in_progress" ? th.gold : th.faint,
            }}
          >
            {i.status === "completed" ? "✓" : i.status === "in_progress" ? "·" : ""}
          </text>
          <text
            style={{display: "flex", flexDirection: "column", 
              fontSize: fs.xs,
              color: i.status === "completed" ? th.faint : th.dim,
              textDecoration: i.status === "completed" ? "line-through" : "none",
              flexShrink: 1,
            }}
          >
            {clip(one(i.content), 240)}
          </text>
        </div>
      ))}
    </div>
  );
}

const Badge = ({ label, color, th }: { label: string; color: string; th: ToolTheme }) => (
  <div
    style={{ display: "flex", flexDirection: "column", 
      alignSelf: "flex-start",
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 2,
      paddingBottom: 2,
      borderRadius: 99,
      backgroundColor: th.glass,
      borderWidth: 1,
      borderColor: th.border,
    }}
  >
    <text style={{ fontSize: fs.xs, color, fontWeight: 650 }}>{label}</text>
  </div>
);

const KvRow = ({ k, v, th }: { k: string; v: string; th: ToolTheme }) => (
  <div style={{ display: "flex",  flexDirection: "row", gap: 8 }}>
    <text style={{ display: "flex", flexDirection: "column",  fontSize: fs.xs, color: th.faint, fontWeight: 600, width: 60, flexShrink: 0 }}>{k}</text>
    <text style={{ display: "flex", flexDirection: "column",  fontSize: fs.xs, color: th.dim, flexGrow: 1 }}>{clip(one(v), 180)}</text>
  </div>
);

/** Nicer render of a tool-call body: JSON → checklist / badges / key-value */
export function ToolBody(props: { toolName: string; rawText: string; theme: ToolTheme }): ReactNode {
  const name = (props.toolName || "").toLowerCase();
  const t = (props.rawText ?? "").trim();
  const j = tryParse(t);
  const th = props.theme;

  // todo write → checklist
  if (/todo/.test(name)) {
    const content = j ? String(j.content ?? j.text ?? j.todos ?? "") : t;
    const list = <TodoList content={content} raw={t} th={th} />;
    if (list) return list;
  }

  // pantheon-state: log event / kv set / register run
  if (/pantheon/.test(name) && j) {
    const kind = String(j.kind ?? "");
    const detail = String(j.detail ?? j.value ?? j.task_summary ?? "");
    if (kind || detail) {
      return (
        <div style={{ display: "flex",  flexDirection: "column", gap: 4 }}>
          {kind ? <Badge label={one(kind)} color={th.cyan} th={th} /> : null}
          {detail ? (
            <text style={{ fontSize: fs.xs, color: th.dim }}>{clip(one(detail), 300)}</text>
          ) : null}
        </div>
      );
    }
  }

  // delegate / subagent → source + instructions
  if (/delegate|subagent|orchestrat/.test(name) && j) {
    const source = String(j.source ?? j.agent ?? j.recipe ?? "");
    const instructions = String(j.instructions ?? j.task ?? j.prompt ?? "");
    const ctx = String(j.context ?? "");
    if (source || instructions || ctx) {
      return (
        <div style={{ display: "flex",  flexDirection: "column", gap: 4 }}>
          {source ? <Badge label={one(source)} color={th.magenta} th={th} /> : null}
          {instructions ? (
            <text style={{ fontSize: fs.xs, color: th.dim }}>{clip(one(instructions), 280)}</text>
          ) : null}
          {ctx ? <text style={{ fontSize: fs.xs, color: th.faint }}>ctx: {clip(one(ctx), 140)}</text> : null}
        </div>
      );
    }
  }

  // read_image / file → path
  if (/read_image|read.file|view.image|image/.test(name) && j) {
    const path = String(j.source ?? j.path ?? j.file ?? j.url ?? "");
    if (path) {
      return (
        <text style={{ fontSize: fs.xs, color: th.cyan }}>🖼 {one(path)}</text>
      );
    }
  }

  // shell / bash → command
  if (/shell|bash|exec|command|run/.test(name) && j) {
    const cmd = String(j.command ?? j.cmd ?? j.script ?? "");
    if (cmd) {
      return (
        <div
          style={{
            backgroundColor: th.glass,
            borderRadius: 9,
            paddingLeft: 8,
            paddingRight: 8,
            paddingTop: 4,
            paddingBottom: 4,
          }}
        >
          <text style={{ fontSize: fs.xs, color: th.text }}>$ {clip(cmd, 360)}</text>
        </div>
      );
    }
  }

  // write / edit / save → path
  if (/write|edit|save|create/.test(name) && j) {
    const path = String(j.path ?? j.file ?? j.filename ?? "");
    if (path) return <text style={{ fontSize: fs.xs, color: th.cyan }}>📝 {one(path)}</text>;
  }

  // load_skill / load → name
  if (/load_skill|load\b/.test(name) && j) {
    const n = String(j.name ?? j.source ?? j.skill ?? "");
    if (n) return <Badge label={`⚙ ${one(n)}`} color={th.gold} th={th} />;
  }

  // generic JSON → key: value
  if (j) {
    const keys = Object.keys(j).slice(0, 6);
    if (keys.length) {
      return (
        <div style={{ display: "flex",  flexDirection: "column", gap: 5 }}>
          {keys.map((k) => {
            const v = j[k];
            const vs = typeof v === "string" ? v : JSON.stringify(v);
            return <KvRow key={k} k={k} v={String(vs ?? "")} th={th} />;
          })}
        </div>
      );
    }
  }

  // plain text
  return <text style={{ fontSize: fs.xs, color: th.dim }}>{clip(t, 400)}</text>;
}
