/**
 * Module-level store of the last opened ACP session.
 * Survives ChatPage remounts (page switches) AND process restarts
 * (localStorage) — connect() calls session/load(lastSid): history is kept,
 * the subagent list (listSubagents by parentId) stays.
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

/** Single write path: memory + localStorage */
export function setLastSid(sid: string | null): void {
  chatSession.lastSid = sid;
  try {
    if (sid) globalThis.localStorage?.setItem(KEY, sid);
    else globalThis.localStorage?.removeItem(KEY);
  } catch (e) {
    // persistence unavailable (private mode / storage quota) — memory copy still works
    log.debug("chatSession.write", e instanceof Error ? e.message : String(e));
  }
}
