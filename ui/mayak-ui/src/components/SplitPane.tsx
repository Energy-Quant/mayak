/**
 * SplitPane — левая | правая панель с divider (pointer capture, как useDragWidth).
 * Правая панель = live-стрим субагента (отдельный scroll-parent — не nested).
 * ratio считаем от ширины окна через useWindowSize (хук GPUIX).
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useWindowSize, type EventPayload } from "@gpuix/react";

export default function SplitPane(props: {
  left: ReactNode;
  right?: ReactNode;
  onCloseRight?: () => void;
  initialRatio?: number;
  hoverColor: string;
  buttonBg: string;
  buttonText: string;
  borderColor: string;
  /** ширина контента (окно − сайдбар), px — row-элементам нужен px/grow, НЕ width:100% */
  widthPx: number;
}) {
  const { left, right, initialRatio = 0.6 } = props;
  const [ratio, setRatio] = useState(initialRatio);
  const [hover, setHover] = useState(false);
  const size = useWindowSize();
  const drag = useRef<{ x0: number; w0: number } | null>(null);

  const onMouseDown = useCallback(
    (e: EventPayload) => {
      drag.current = { x0: e.x ?? 0, w0: ratio };
    },
    [ratio],
  );

  const onMouseMove = useCallback(
    (e: EventPayload) => {
      const st = drag.current;
      if (!st || !size.width) return;
      const dx = (e.x ?? 0) - st.x0;
      const next = Math.min(0.85, Math.max(0.2, st.w0 + dx / size.width));
      setRatio(next);
    },
    [size.width],
  );

  const onMouseUp = useCallback(() => {
    drag.current = null;
  }, []);

  return (
    <div style={{display: "flex", width: props.widthPx, flexDirection: "row", height: "100%", flexShrink: 0, minWidth: 0 }}>
      <div
        style={
          right
            ? {
                display: "flex",
                width: Math.round(ratio * props.widthPx),
                flexGrow: 0,
                flexShrink: 0,
                minWidth: 0,
                height: "100%",
                overflow: "hidden",
                flexDirection: "column",
              }
            : {
                display: "flex",
                width: props.widthPx,
                flexShrink: 0,
                minWidth: 0,
                height: "100%",
                overflow: "hidden",
                flexDirection: "column",
              }
        }
      >
        {left}
      </div>
      {right ? (
        <>
          <div
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
              width: 5,
              cursor: "col-resize",
              backgroundColor: hover ? props.hoverColor : "transparent",
            }}
          />
          <div
            style={{display: "flex", flexDirection: "column",  flexGrow: 1, minWidth: 0, overflow: "hidden", position: "relative" }}
          >
            <div
              onClick={props.onCloseRight}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                paddingLeft: 8,
                paddingRight: 8,
                paddingTop: 4,
                paddingBottom: 4,
                borderRadius: 9,
                backgroundColor: props.buttonBg,
                borderWidth: 1,
                borderColor: props.borderColor,
                cursor: "pointer",
              }}
            >
              <text style={{ color: props.buttonText, fontSize: 12 }}>✕</text>
            </div>
            {right}
          </div>
        </>
      ) : null}
    </div>
  );
}
