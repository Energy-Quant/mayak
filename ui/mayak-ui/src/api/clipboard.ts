/**
 * api/clipboard.ts — порт clipboard_image() (wl-paste).
 * Формат: { mime, data: number[] } | null — паритет serde_json Vec<u8>.
 * wl-paste — primary для image на Wayland; GPUIX clipboard API = fallback (шаг 8).
 */

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
