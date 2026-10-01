/**
 * useDragWidth — panel resize via GPUIX pointer capture:
 * onMouseDown + onMouseMove + onMouseUp ON ONE node = pointer capture
 * (like setPointerCapture in the DOM — see examples/timeline.tsx).
 */
import { useCallback, useRef } from "react";
import type { EventPayload } from "@gpuix/react";

export function useDragWidth(
  get: () => number,
  set: (w: number) => void,
  opts: { min: number; max: number; /** true: dragging left widens (right panel) */ invert?: boolean },
) {
  const drag = useRef<{ x0: number; w0: number } | null>(null);

  const onMouseDown = useCallback(
    (e: EventPayload) => {
      drag.current = { x0: e.x ?? 0, w0: get() };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [get],
  );

  const onMouseMove = useCallback(
    (e: EventPayload) => {
      const st = drag.current;
      if (!st) return;
      const dx = (e.x ?? 0) - st.x0;
      const w = st.w0 + (opts.invert ? -dx : dx);
      set(Math.min(opts.max, Math.max(opts.min, w)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [set],
  );

  const onMouseUp = useCallback(() => {
    drag.current = null;
  }, []);

  return { onMouseDown, onMouseMove, onMouseUp };
}
