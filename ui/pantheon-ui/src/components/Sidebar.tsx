// Sidebar — паритет оригинала Goose Desktop
import { useEffect, useState } from "react";
import { listSessions } from "../api";

export type Page =
  | "chat" | "recipes" | "extensions" | "scheduler"
  | "history" | "apps" | "settings";

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: "chat", label: "Новый чат", icon: "✚" },
  { id: "recipes", label: "Рецепты", icon: "📋" },
  { id: "settings", label: "Настройки", icon: "⚙" },
  { id: "apps", label: "Приложения", icon: "▣" },
  { id: "extensions", label: "Расширения", icon: "◫" },
  { id: "scheduler", label: "Планировщик", icon: "⏱" },
  { id: "history", label: "История сессий", icon: "🕘" },
];

export default function Sidebar(props: {
  page: Page; onNavigate: (p: Page) => void; onOpenSession: (id: string) => void;
}) {
  const [sessions, setSessions] = useState<{ id: string; title: string; running: boolean }[]>([]);

  useEffect(() => {
    const load = () => listSessions().then(setSessions).catch(() => setSessions([]));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button className="logo-btn" title="Пантеон">🪿</button>
      </div>
      <nav>
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`nav-item${props.page === n.id ? " active" : ""}`}
            onClick={() => props.onNavigate(n.id)}
          >
            <span className="nav-icon">{n.icon}</span> {n.label}
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
        <span className="nav-icon">⚙</span> Настройки
      </button>
    </aside>
  );
}
