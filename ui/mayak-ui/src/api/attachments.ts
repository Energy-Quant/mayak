/**
 * api/attachments.ts — порт stage_attachment + read_file_bytes.
 * Кэш: ~/.cache/goose/mayak-attachments/ (новое имя UI; Phase 0/1 не трогаем).
 * Лимит файла 25 МБ — паритет.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { log } from "../logger";

const MAX_BYTES = 25 * 1024 * 1024;

/** bytes → временный файл → путь для goose (паритет stage_attachment) */
export function stageAttachment(name: string, data: Uint8Array | number[]): string {
  const base = join(homedir(), ".cache/goose/mayak-attachments");
  mkdirSync(base, { recursive: true });
  const safe =
    [...name]
      .map((c) => (/[a-zA-Z0-9._-]/.test(c) ? c : "_"))
      .join("") || `attachment-${process.pid}`;
  const finalSafe = safe === "." || safe === ".." ? `attachment-${process.pid}` : safe;
  const path = join(base, `${Date.now()}-${finalSafe}`);
  writeFileSync(path, data instanceof Uint8Array ? data : Uint8Array.from(data));
  return path;
}

/** Чтение файла для превью/ACP image — number[] (паритет Vec<u8> → JSON array) */
export async function readFileBytes(path: string): Promise<number[]> {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`не найден: ${path}`);
  }
  const meta = statSync(path);
  if (meta.size > MAX_BYTES) throw new Error("файл больше 25 МБ");
  const buf = await Bun.file(path).arrayBuffer();
  return Array.from(new Uint8Array(buf));
}

/** Жатие ≤1024px → JPEG q85 через ImageMagick (паритет compressImageDataUrl); нет magick → оригинал */
export function compressImageBytes(
  bytes: Uint8Array,
  mime: string,
): { bytes: Uint8Array; mimeType: string } {
  if (!/^image\/(png|jpe?g|webp|gif|bmp|avif)$/.test(mime)) return { bytes, mimeType: mime };
  try {
    const r = Bun.spawnSync(["magick", "-", "-resize", "1024x1024>", "-quality", "85", "jpeg:-"], {
      stdin: bytes,
    });
    if (r.exitCode === 0 && r.stdout.length > 0) {
      return { bytes: new Uint8Array(r.stdout), mimeType: "image/jpeg" };
    }
  } catch (e) {
    log.fail("attachments.read", e);
    /* нет ImageMagick */
  }
  return { bytes, mimeType: mime };
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${toBase64(bytes)}`;
}
