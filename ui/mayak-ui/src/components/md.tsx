/**
 * md.tsx — обёртка над host-элементом <markdown> с токенами темы «Волна».
 * Заменяет legacy markdown.ts (dangerouslySetInnerHTML) — без HTML-рендера.
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

/** Курсив для thinking: построчно (italic не переносится между строками в markdown) */
export function italicize(src: string): string {
  return (src ?? "")
    .split("\n")
    .map((l) => (l.trim() ? `*${l.replace(/\*/g, "\\*")}*` : ""))
    .join("\n");
}

/** Пользовательский текст: сохраняем \n (строками — GPUI не склеивает) */
export function UserText(props: { text: string; t: WaveTheme; fontSize: number }) {
  const lines = (props.text ?? "").split("\n");
  return (
    <div style={{display: "flex",  flexDirection: "column", minWidth: 0 }}>
      {lines.map((l, i) => (
        <text key={i} style={{ fontSize: props.fontSize, color: props.t.text, lineHeight: 1.55 }}>
          {l === "" ? " " : l}
        </text>
      ))}
    </div>
  );
}
