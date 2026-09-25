/**
 * windowKeys — реестр window-level keydown обработчика (GPUIX: хендлеры
 * передаются в render(), компоненты регистрируются сюда через useEffect).
 */
import type { EventPayload } from "@gpuix/react";

export const winKeys: {
  handler: ((e: EventPayload) => void) | null;
} = {
  handler: null,
};
