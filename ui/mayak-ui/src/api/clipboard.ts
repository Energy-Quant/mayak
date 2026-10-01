/**
 * api/clipboard.ts — port of clipboard_image() (wl-paste).
 * Format: { mime, data: number[] } | null — parity with serde_json Vec<u8>.
 * wl-paste — primary for images on Wayland; GPUIX clipboard API = fallback (step 8).
 */
import { log } from "../logger";

/** Copy text to the system clipboard (Wayland wl-copy); silent when unavailable */
export function copyText(text: string): void {
  try {
    const p = Bun.spawn(["wl-copy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    p.stdin.write(text);
    p.stdin.end();
  } catch (e) {
    log.fail("clipboard.wl-paste", e);
    /* no wl-clipboard — stay silent (parity with DOM-less fallbackCopy) */
  }
}

export function clipboardImage(): { mime: string; data: number[] } | null {
  const types = Bun.spawnSync(["wl-paste", "--list-types"]);
  if (types.exitCode !== 0) return null; // no wl-clipboard — simply no image
  const text = new TextDecoder().decode(types.stdout);
  const mime = ["image/png", "image/jpeg", "image/webp"].find((m) =>
    text.split("\n").some((l) => l.trim() === m),
  );
  if (!mime) return null;
  const out = Bun.spawnSync(["wl-paste", "-t", mime]);
  if (out.exitCode !== 0 || out.stdout.length === 0) return null;
  return { mime, data: Array.from(out.stdout) };
}
