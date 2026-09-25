/**
 * windowKeys — реестр window-level keydown (GPUIX: хендлеры в render()).
 * handler — верхний уровень (App: Esc/Ctrl+T); chat — чат-слой (Ctrl+V вложения).
 */
import type { EventPayload } from "@gpuix/react";

export const winKeys: {
  handler: ((e: EventPayload) => void) | null;
  chat: ((e: EventPayload) => void) | null;
} = {
  handler: null,
  chat: null,
};
