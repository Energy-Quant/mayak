// useDragWidth — мышиный ресайз панели по горизонтали (сайдбар, правая колонка).
import { useCallback, useRef } from "react";

export function useDragWidth(
  get: () => number,
  set: (w: number) => void,
  opts: { min: number; max: number; /** true: drag влево = шире (правая панель) */ invert?: boolean }
) {
  const dragging = useRef(false);

  const onMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging.current) return;
      // базовые значения захвачены в startDrag
      const st = dragState.current;
      if (!st) return;
      const dx = e.clientX - st.x0;
      const w = st.w0 + (opts.invert ? -dx : dx);
      set(Math.min(opts.max, Math.max(opts.min, w)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [set]
  );

  const onUp = useCallback(() => {
    dragging.current = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }, [onMove]);

  const dragState = useRef<{ x0: number; w0: number } | null>(null);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragState.current = { x0: e.clientX, w0: get() };
      dragging.current = true;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [get, onMove, onUp]
  );

  return startDrag;
}
