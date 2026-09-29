/**
 * api/clipboard.ts — порт clipboard_image() (wl-paste).
 * Формат: { mime, data: number[] } | null — паритет serde_json Vec<u8>.
 * wl-paste — primary для image на Wayland; GPUIX clipboard API = fallback (шаг 8).
 */
import { log } from "../logger";

/** Копирование текста в системный буфер (Wayland wl-copy); тихо при отсутствии */
export function copyText(text: string): void {
  try {
    const p = Bun.spawn(["wl-copy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    p.stdin.write(text);
    p.stdin.end();
  } catch (e) {
    log.fail("clipboard.wl-paste", e);
    /* нет wl-clipboard — молчим (паритет fallbackCopy без DOM) */
  }
}

export function clipboardImage(): { mime: string; data: number[] } | null {
  const types = Bun.spawnSync(["wl-paste", "--list-types"]);
  if (types.exitCode !== 0) return null; // нет wl-clipboard — просто нет картинки
  const text = new TextDecoder().decode(types.stdout);
  const mime = ["image/png", "image/jpeg", "image/webp"].find((m) =>
    text.split("\n").some((l) => l.trim() === m),
  );
  if (!mime) return null;
  const out = Bun.spawnSync(["wl-paste", "-t", mime]);
  if (out.exitCode !== 0 || out.stdout.length === 0) return null;
  return { mime, data: Array.from(out.stdout) };
}
