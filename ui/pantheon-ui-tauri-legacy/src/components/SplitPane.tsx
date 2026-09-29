// SplitPane — родитель | субагент (Патч 2 из плана). Live-стрим через ACP.
import React, { useCallback, useRef, useState } from "react";

export default function SplitPane(props: {
  left: React.ReactNode;
  right?: React.ReactNode;
  onCloseRight?: () => void;
  initialRatio?: number;
}) {
  const { left, right, onCloseRight, initialRatio = 0.6 } = props;
  const [ratio, setRatio] = useState(initialRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const next = Math.min(0.85, Math.max(0.2, (e.clientX - rect.left) / rect.width));
    setRatio(next);
  }, []);

  const onMouseUp = useCallback(() => {
    dragging.current = false;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  }, [onMouseMove]);

  const startDrag = () => {
    dragging.current = true;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div className="split" ref={containerRef}>
      <div className="pane" style={{ flex: right ? `0 0 ${ratio * 100}%` : 1 }}>{left}</div>
      {right && (
        <>
          <div className="divider" onMouseDown={startDrag} />
          <div className="pane" style={{ flex: 1, position: "relative" }}>
            <button
              onClick={onCloseRight}
              style={{ position: "absolute", top: 8, right: 8, zIndex: 10 }}
              title="Закрыть (Esc)"
            >✕</button>
            {right}
          </div>
        </>
      )}
    </div>
  );
}
