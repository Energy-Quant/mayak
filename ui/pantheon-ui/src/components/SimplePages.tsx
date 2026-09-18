// История сессий + Рецепты (паритет) — и Настройки с вкладками оригинала
import { useEffect, useState } from "react";
import { listSessions, listRecipes, SessionRow, RecipeRow } from "../api";

export function History() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => { listSessions(onlyRunning).then(setRows).catch(() => setRows([])); }, [onlyRunning]);

  const filtered = rows.filter((r) => r.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <h1>История сессий</h1>
      <div className="row-actions">
        <input className="text-input" placeholder="Поиск по сессиям…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={onlyRunning ? "primary" : ""} onClick={() => setOnlyRunning(!onlyRunning)}>
          {onlyRunning ? "● Активные" : "○ Все"}
        </button>
      </div>
      <table className="table">
        <thead><tr><th>Сессия</th><th>Тип</th><th>Токены</th><th>Обновлена</th></tr></thead>
        <tbody>
          {filtered.map((s) => (
            <tr key={s.id}>
              <td>{s.running && <span className="chat-dot on" />} {s.title}</td>
              <td className="dim">{s.session_type}</td>
              <td className="dim">{s.total_tokens.toLocaleString("ru")}</td>
              <td className="dim">{s.updated_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 && <div className="empty">Нет сессий</div>}
    </div>
  );
}

export function Recipes() {
  const [rows, setRows] = useState<RecipeRow[]>([]);
  useEffect(() => { listRecipes().then(setRows).catch(() => setRows([])); }, []);
  return (
    <div className="page">
      <h1>Рецепты</h1>
      <p className="page-desc">Переиспользуемые конфигурации goose: инструкции, параметры, расширения.</p>
      <div className="card-list">
        {rows.map((r) => (
          <div key={r.file} className="chain-card">
            <h3>{r.title || r.file}</h3>
            <div className="dim">{r.description || "—"}</div>
            <div className="ext-desc mono">{r.path}</div>
          </div>
        ))}
      </div>
      {rows.length === 0 && <div className="empty">Нет рецептов в ~/.config/goose/recipes</div>}
    </div>
  );
}
