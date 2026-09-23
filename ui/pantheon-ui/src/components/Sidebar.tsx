// Sidebar — паритет оригинала Goose Desktop (контурные SVG-иконки)
import { useEffect, useState } from "react";
import { listSessions } from "../api";
import { Icon, IconName } from "./Icon";
import { useDragWidth } from "../useDragWidth";

export type Page =
  | "chat" | "recipes" | "extensions" | "scheduler"
  | "history" | "apps" | "settings" | "pantheon" | "chains";

const NAV: { id: Page; label: string; icon: IconName }[] = [
  { id: "chat", label: "Новый чат", icon: "plus" },
  { id: "recipes", label: "Рецепты", icon: "clipboard" },
  { id: "settings", label: "Настройки", icon: "settings" },
  { id: "apps", label: "Приложения", icon: "app" },
  { id: "extensions", label: "Расширения", icon: "puzzle" },
  { id: "scheduler", label: "Планировщик", icon: "clock" },
  { id: "history", label: "История сессий", icon: "history" },
  { id: "pantheon", label: "Пантеон", icon: "goose" },
  { id: "chains", label: "Цепочки агентов", icon: "clipboard" },
];

export default function Sidebar(props: {
  page: Page; onNavigate: (p: Page) => void; onOpenSession: (id: string) => void;
  width: number; onWidth: (w: number) => void;
}) {
  const startResize = useDragWidth(() => props.width, props.onWidth, { min: 180, max: 420 });
  const [sessions, setSessions] = useState<{ id: string; title: string; running: boolean }[]>([]);

  useEffect(() => {
    const load = () =>
      listSessions()
        .then((all) =>
          setSessions(
            // Иерархия: слева — только основные чаты; sub_agent/hidden/gateway и дети — внутрь
            all.filter(
              (s: any) =>
                !["sub_agent", "hidden", "gateway"].includes(s.session_type) &&
                !s.parent_session_id
            )
          )
        )
        .catch(() => setSessions([]));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <aside className="sidebar" style={{ width: props.width, minWidth: props.width }}>
      <div className="sidebar-top">
        <button className="logo-btn" title="Пантеон"><Icon name="goose" size={20} /></button>
      </div>
      <nav>
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`nav-item${props.page === n.id ? " active" : ""}`}
            onClick={() => props.onNavigate(n.id)}
          >
            <span className="nav-icon"><Icon name={n.icon} /></span> {n.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-section">ЧАТЫ</div>
      <div className="chat-list">
        {sessions.map((s) => (
          <button key={s.id} className="chat-item" onClick={() => props.onOpenSession(s.id)} title={s.id}>
            <span className={`chat-dot${s.running ? " on" : ""}`} />
            <span className="chat-title">{s.title}</span>
          </button>
        ))}
        {sessions.length === 0 && <div className="chat-empty">Нет сессий</div>}
      </div>
      <button
        className={`nav-item bottom${props.page === "settings" ? " active" : ""}`}
        onClick={() => props.onNavigate("settings")}
      >
        <span className="nav-icon"><Icon name="settings" /></span> Настройки
      </button>
      <div className="resize-handle" onMouseDown={startResize} title="Потянуть — изменить ширину" />
    </aside>
  );
}
