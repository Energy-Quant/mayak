/**
 * api/attachments.ts — port of stage_attachment + read_file_bytes.
 * Cache: ~/.cache/goose/mayak-attachments/ (new UI name; Phase 0/1 untouched).
 * 25 MB file limit — parity.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { log } from "../logger";
import { AppError, E } from "../errors";

const MAX_BYTES = 25 * 1024 * 1024;

/** bytes → temp file → path for goose (parity with stage_attachment) */
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

/** Read a file for preview/ACP image — number[] (parity: Vec<u8> → JSON array) */
export async function readFileBytes(path: string): Promise<number[]> {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new AppError(E.FILE_NOT_FOUND, `not found: ${path}`, { context: { path } });
  }
  const meta = statSync(path);
  if (meta.size > MAX_BYTES) throw new AppError(E.FILE_TOO_BIG, `file larger than 25 MB: ${path}`, { context: { path, size: meta.size } });
  const buf = await Bun.file(path).arrayBuffer();
  return Array.from(new Uint8Array(buf));
}

/** Downscale ≤1024px → JPEG q85 via ImageMagick (parity with compressImageDataUrl); no magick → original */
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
    /* ImageMagick not installed — keep the original */
  }
  return { bytes, mimeType: mime };
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${toBase64(bytes)}`;
}
