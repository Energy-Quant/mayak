// toolRender.ts — структурированный рендер tool-call body вместо сырого JSON.
// Вход: toolName + rawText (JSON.stringify(rawInput) или plain output).
// Выход: безопасный HTML для dangerouslySetInnerHTML.
import { parseTodos } from "./acp";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Однострочный безопасный текст */
const esc1 = (s: string) =>
  esc(s.replace(/\\n/g, " ").replace(/\s+/g, " ").trim());

/** Обрезка с многоточием */
const clip = (s: string, n: number) =>
  s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "…";

function tryParse(raw: string): Record<string, unknown> | null {
  const t = (raw ?? "").trim();
  if (!t.startsWith("{")) return null;
  try {
    const p = JSON.parse(t);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Красивый рендер тела tool-call: JSON → чек-лист / бейджи / ключ-значение */
export function renderToolBody(toolName: string, rawText: string): string {
  const name = (toolName || "").toLowerCase();
  const t = (rawText ?? "").trim();
  const j = tryParse(t);

  // ── todo write → чек-лист ──
  if (/todo/.test(name)) {
    const content = j ? String(j.content ?? j.text ?? j.todos ?? "") : t;
    const items = parseTodos(content);
    if (items.length) {
      return `<ul class="tool-todo">${items
        .map(
          (i) =>
            `<li class="tt-${i.status}"><span class="tt-box">${i.status === "completed" ? "✓" : i.status === "in_progress" ? "·" : ""}</span><span class="tt-txt">${esc1(i.content)}</span></li>`,
        )
        .join("")}</ul>`;
    }
  }

  // ── pantheon-state: log event / kv set / register run ──
  if (/pantheon/.test(name) && j) {
    const kind = String(j.kind ?? "");
    const detail = String(j.detail ?? j.value ?? j.task_summary ?? "");
    const bits: string[] = [];
    if (kind) bits.push(`<span class="tool-badge">${esc1(kind)}</span>`);
    if (detail) bits.push(`<div class="tool-detail">${esc1(clip(detail, 300))}</div>`);
    if (bits.length) return `<div class="tool-kv">${bits.join("")}</div>`;
  }

  // ── delegate / subagent → source + instructions ──
  if (/delegate|subagent|orchestrat/.test(name) && j) {
    const source = String(j.source ?? j.agent ?? j.recipe ?? "");
    const instructions = String(j.instructions ?? j.task ?? j.prompt ?? "");
    const ctx = String(j.context ?? "");
    const bits: string[] = [];
    if (source) bits.push(`<span class="tool-badge accent-magenta">${esc1(source)}</span>`);
    if (instructions) bits.push(`<div class="tool-detail">${esc1(clip(instructions, 280))}</div>`);
    if (ctx) bits.push(`<div class="tool-detail dim">ctx: ${esc1(clip(ctx, 140))}</div>`);
    if (bits.length) return `<div class="tool-kv">${bits.join("")}</div>`;
  }

  // ── read_image / файл → путь ──
  if (/read_image|read.file|view.image|image/.test(name) && j) {
    const path = String(j.source ?? j.path ?? j.file ?? j.url ?? "");
    if (path) return `<div class="tool-kv"><span class="tool-path">🖼 ${esc1(path)}</span></div>`;
  }

  // ── shell / bash → команда ──
  if (/shell|bash|exec|command|run/.test(name) && j) {
    const cmd = String(j.command ?? j.cmd ?? j.script ?? "");
    if (cmd) return `<pre class="tool-cmd">$ ${esc(clip(cmd, 360))}</pre>`;
  }

  // ── write / edit / save → путь ──
  if (/write|edit|save|create/.test(name) && j) {
    const path = String(j.path ?? j.file ?? j.filename ?? "");
    if (path) return `<div class="tool-kv"><span class="tool-path">📝 ${esc1(path)}</span></div>`;
  }

  // ── load_skill / load → имя ──
  if (/load_skill|load\b/.test(name) && j) {
    const n = String(j.name ?? j.source ?? j.skill ?? "");
    if (n) return `<div class="tool-kv"><span class="tool-badge">⚙ ${esc1(n)}</span></div>`;
  }

  // ── generic JSON → ключ: значение ──
  if (j) {
    const keys = Object.keys(j).slice(0, 6);
    if (keys.length) {
      const rows = keys
        .map((k) => {
          const v = j[k];
          const vs = typeof v === "string" ? v : JSON.stringify(v);
          return `<div class="tool-kv-row"><span class="tool-k">${esc1(k)}</span><span class="tool-v">${esc1(clip(String(vs ?? ""), 180))}</span></div>`;
        })
        .join("");
      return `<div class="tool-kv">${rows}</div>`;
    }
  }

  // ── plain text ──
  return `<div class="tool-plain">${esc(clip(t, 400))}</div>`;
}

/** Однострочная сводка tool-call (для заголовка/чипа) */
export function toolSummary(toolName: string, rawText: string): string {
  const name = (toolName || "").toLowerCase();
  const t = (rawText ?? "").trim();
  const j = tryParse(t);

  if (/todo/.test(name)) {
    const content = j ? String(j.content ?? j.text ?? "") : t;
    const items = parseTodos(content);
    const done = items.filter((i) => i.status === "completed").length;
    return items.length ? `${done}/${items.length} пунктов` : "список задач";
  }
  if (/pantheon/.test(name) && j) {
    return String(j.kind ?? "событие");
  }
  if (/delegate|subagent/.test(name) && j) {
    return String(j.source ?? j.agent ?? "субагент");
  }
  if (/read_image/.test(name) && j) {
    const p = String(j.source ?? j.path ?? "");
    return p.split("/").pop() || "изображение";
  }
  if (/shell|bash|exec/.test(name) && j) {
    const c = String(j.command ?? j.cmd ?? "");
    return clip(esc1(c), 60);
  }
  return clip(esc1(t), 60);
}
