// TitleBar — тонкая полоска вместо системной: drag-регион + контурные кнопки. Без названия приложения.
// Вне Tauri (браузер/dev) — демо-режим: кнопки неактивны, не мешают рендеру.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "./Icon";

interface WinApi {
  minimize(): void; toggleMaximize(): void; close(): void;
}
const getWin = (): WinApi | null => {
  try { return getCurrentWindow(); } catch { return null; }
};

export default function TitleBar() {
  const act = (fn: (w: WinApi) => void) => {
    const w = getWin(); if (w) fn(w);
  };
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-drag" data-tauri-drag-region />
      <div className="titlebar-buttons">
        <button className="tb-btn" onClick={() => act((w) => w.minimize())} title="Свернуть">
          <Icon name="minus" />
        </button>
        <button className="tb-btn" onClick={() => act((w) => w.toggleMaximize())} title="Развернуть">
          <Icon name="square" />
        </button>
        <button className="tb-btn tb-close" onClick={() => act((w) => w.close())} title="Закрыть">
          <Icon name="x" />
        </button>
      </div>
    </div>
  );
}
