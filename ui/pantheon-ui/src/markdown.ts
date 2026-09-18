// markdown.ts — лёгкий markdown-рендер без зависимостей (код, заголовки, списки, bold/italic/ссылки/inline-code)
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Inline = (s: string) => string;

const inline: Inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

export function renderMarkdown(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let inCode = false;
  let lang = "";
  let codeBuf: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };

  for (const raw of lines) {
    const fence = raw.match(/^```\s*(\S*)/);
    if (fence) {
      if (inCode) { out.push(`<pre class="md-code" data-lang="${lang}"><code>${esc(codeBuf.join("\n"))}</code></pre>`); inCode = false; }
      else { closeList(); inCode = true; lang = fence[1] ?? ""; codeBuf = []; }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    const h = raw.match(/^(#{1,4})\s+(.*)/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    const ul = raw.match(/^\s*[-*•]\s+(.*)/);
    const ol = raw.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul) { if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; } out.push(`<li>${inline(ul[1])}</li>`); continue; }
    if (ol) { if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; } out.push(`<li>${inline(ol[1])}</li>`); continue; }

    if (/^\s*\|.*\|\s*$/.test(raw)) { // тривиальные таблицы — как preformatted
      out.push(`<div class="md-table-row">${inline(raw.trim())}</div>`); continue;
    }

    if (raw.trim() === "") { closeList(); continue; }

    if (/^$/.test(raw) === false && /^[A-Za-zА-Яа-я0-9]/.test(raw.trim()) === false && !out.length) continue;

    // абзац — склеиваем последовательные строки
    const last = out.length - 1;
    if (out[last]?.startsWith("<p") && !out[last].endsWith("</p>")) {
      out[last] = out[last].replace(/<\/?p[^>]*>?/g, "") + " " + inline(raw);
      out[last] = "<p>" + out[last] + "</p>";
    } else {
      out.push(`<p>${inline(raw)}</p>`);
    }
  }
  if (inCode) out.push(`<pre class="md-code" data-lang="${lang}"><code>${esc(codeBuf.join("\n"))}</code></pre>`);
  closeList();
  return out.join("\n");
}
