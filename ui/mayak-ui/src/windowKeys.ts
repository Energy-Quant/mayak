/**
 * windowKeys — registry of window-level keydown handlers (GPUIX: handlers run in render()).
 * handler — top level (App: Esc/Ctrl+T); chat — chat layer (Ctrl+V attachments).
 */
import type { EventPayload } from "@gpuix/react";

export const winKeys: {
  handler: ((e: EventPayload) => void) | null;
  chat: ((e: EventPayload) => void) | null;
} = {
  handler: null,
  chat: null,
};
