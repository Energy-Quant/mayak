/**
 * Модульное хранилище последней открытой ACP-сессии.
 * Переживает remount ChatPage (переключения страниц) И рестарт процесса
 * (localStorage) — connect() делает session/load(lastSid): история не теряется,
 * список субагентов (listSubagents по parentId) остаётся.
 */
const KEY = "mayak-last-sid";
import { log } from "./logger";

let initial: string | null = null;
try {
  initial = globalThis.localStorage?.getItem(KEY) ?? null;
} catch (e) {
  log.debug("chatSession.read", e instanceof Error ? e.message : String(e));
  initial = null;
}

export const chatSession = { lastSid: initial as string | null };

/** Единственная точка записи: память + localStorage */
export function setLastSid(sid: string | null): void {
  chatSession.lastSid = sid;
  try {
    if (sid) globalThis.localStorage?.setItem(KEY, sid);
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* нет localStorage */
  }
}
