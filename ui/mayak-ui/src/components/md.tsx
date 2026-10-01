/**
 * md.tsx — wrapper around the <markdown> host element with "Wave" theme tokens.
 * Replaces legacy markdown.ts (dangerouslySetInnerHTML) — no HTML rendering.
 */
import type { GpuixTheme } from "@gpuix/react";
import { dark, font, type WaveTheme } from "../tokens";

export function mdTheme(t: WaveTheme): GpuixTheme {
  return {
    appearance: t === dark ? "dark" : "light",
    bg: t.bg,
    border: t.border,
    text: t.text,
    textMuted: t.dim,
    textFaint: t.faint,
    textDim: t.dim,
    accent: t.magenta,
    caret: t.magenta,
    codeText: t.cyan,
    codeWash: t.glass,
    fontSans: font,
    fontMono: font,
  };
}

export function Markdown(props: { source: string; t: WaveTheme }) {
  return <markdown source={props.source} theme={mdTheme(props.t)} />;
}

/** Italic for thinking: line by line (italic does not carry across lines in markdown) */
export function italicize(src: string): string {
  return (src ?? "")
    .split("\n")
    .map((l) => (l.trim() ? `*${l.replace(/\*/g, "\\*")}*` : ""))
    .join("\n");
}

/** User text: preserve \n (GPUI does not join lines) */
export function UserText(props: { text: string; t: WaveTheme; fontSize: number }) {
  const lines = (props.text ?? "").split("\n");
  return (
    <div style={{display: "flex",  flexDirection: "column", minWidth: 0 }}>
      {lines.map((l, i) => (
        <text
          key={i}
          style={{
            fontSize: props.fontSize,
            color: props.t.text,
            // GPUIX: lineHeight is PIXELS (renderer.js: fs13 → lh20), not a CSS multiplier!
            // 1.55 (as in CSS) = 1.55px → lines collapse and stick together
            lineHeight: Math.round(props.fontSize * 1.55),
          }}
        >
          {l === "" ? " " : l}
        </text>
      ))}
    </div>
  );
}
