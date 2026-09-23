// markdown.ts — лёгкий markdown-рендер без зависимостей:
// заголовки, списки, таблицы, code-fence, bold/italic/strike/links/inline-code.
// Снимает markdown-экранирование \* \_ \\ и т.п. (модели часто присылают \*\*вместо **).

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** \* → *, \_ → _, \\ → \ — иначе bold/italic проходят сырым текстом */
const unescapeMd = (s: string) => s.replace(/\\([\\`*_{}\[\]()#+\-.!|~<>])/g, "$1");

const inline = (s: string): string =>
  esc(unescapeMd(s))
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?=\W|$)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

/** ячейки таблицы: | a | b | → [a, b] */
const splitRow = (raw: string): string[] =>
  raw.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

const isTableRow = (raw: string) => /^\s*\|.*\|\s*$/.test(raw);
const isTableSep = (raw: string) => isTableRow(raw) && splitRow(raw).every((c) => /^:?-{2,}:?$/.test(c));

/** Пользовательский текст: сохраняем переводы строк (Shift+Enter), без «склейки абзацев» */
export function renderUserText(src: string): string {
  return `<p>${inline(src).replace(/\n/g, "<br>")}</p>`;
}

export function renderMarkdown(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let inCode = false;
  let lang = "";
  let codeBuf: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let tableBuf: string[][] | null = null;
  let tableHeader = false;

  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const closeTable = () => {
    if (!tableBuf) return;
    const [head, ...rest] = tableBuf;
    let html = '<table class="md-table">';
    if (tableHeader && head) {
      html += `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>`;
    }
    const body = tableHeader ? rest : tableBuf;
    html += `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    out.push(html);
    tableBuf = null; tableHeader = false;
  };

  for (const raw of lines) {
    const fence = raw.match(/^```\s*(\S*)/);
    if (fence) {
      if (inCode) { closeTable(); out.push(`<pre class="md-code" data-lang="${lang}"><code>${esc(codeBuf.join("\n"))}</code></pre>`); inCode = false; }
      else { closeList(); closeTable(); inCode = true; lang = fence[1] ?? ""; codeBuf = []; }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    // таблицы: header + sep-строка, затем тело; накапливаем подряд идущие строки
    if (isTableRow(raw)) {
      closeList();
      if (!tableBuf) { tableBuf = []; tableHeader = false; }
      if (isTableSep(raw)) { tableHeader = true; continue; }
      tableBuf.push(splitRow(raw));
      continue;
    }
    closeTable();

    const h = raw.match(/^(#{1,4})\s+(.*)/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    const ul = raw.match(/^\s*[-*•]\s+(.*)/);
    const ol = raw.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul) { if (listType !== "ul") { closeList(); out.push('<ul class="md-ul">'); listType = "ul"; } out.push(`<li>${inline(ul[1])}</li>`); continue; }
    if (ol) { if (listType !== "ol") { closeList(); out.push('<ol class="md-ol">'); listType = "ol"; } out.push(`<li>${inline(ol[1])}</li>`); continue; }

    if (raw.trim() === "") { closeList(); continue; }

    // абзац: продолжаем предыдущий <p> без перевода строки
    const last = out.length - 1;
    if (out[last]?.startsWith("<p") && out[last].endsWith("</p>")) {
      out[last] = `<p>${out[last].slice(3, -4)} ${inline(raw)}</p>`;
    } else {
      out.push(`<p>${inline(raw)}</p>`);
    }
  }
  if (inCode) out.push(`<pre class="md-code" data-lang="${lang}"><code>${esc(codeBuf.join("\n"))}</code></pre>`);
  closeList(); closeTable();
  return out.join("\n");
}
