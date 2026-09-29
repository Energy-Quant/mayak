// История сессий + Рецепты (паритет)
import { useEffect, useMemo, useState } from "react";
import { listSessions, listRecipes, SessionRow, RecipeRow } from "../api";

type SortKey = "title" | "session_type" | "total_tokens" | "updated_at" | "running";

/** SQLite/ISO → «23.09.2026, 14:05» */
function fmtDate(s: string): string {
  if (!s) return "—";
  const iso = s.includes("T") ? s : s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sortVal(r: SessionRow, k: SortKey): string | number {
  if (k === "total_tokens") return r.total_tokens ?? 0;
  if (k === "running") return r.running ? 1 : 0;
  if (k === "title") return r.title.toLowerCase();
  if (k === "session_type") return r.session_type.toLowerCase();
  return r.updated_at.toLowerCase();
}

export function History() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);

  useEffect(() => {
    listSessions(onlyRunning).then(setRows).catch(() => setRows([]));
  }, [onlyRunning]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(k === "total_tokens" || k === "running" ? -1 : 1);
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        !needle ||
        r.title.toLowerCase().includes(needle) ||
        r.id.toLowerCase().includes(needle) ||
        r.session_type.toLowerCase().includes(needle)
    );
    return [...list].sort((a, b) => {
      // работающие сессии всегда наверху
      if (a.running !== b.running) return a.running ? -1 : 1;
      const av = sortVal(a, sortKey);
      const bv = sortVal(b, sortKey);
      if (av < bv) return -sortDir;
      if (av > bv) return sortDir;
      return 0;
    });
  }, [rows, q, sortKey, sortDir]);

  const mark = (k: SortKey) => (sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : "");

  return (
    <div className="page">
      <h1>История сессий</h1>
      <p className="page-desc">Сессии goose из sessions.db: название, тип, токены и активность.</p>
      <div className="row-actions">
        <input
          className="text-input"
          placeholder="Поиск по сессиям…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className={onlyRunning ? "primary" : ""} onClick={() => setOnlyRunning(!onlyRunning)}>
          {onlyRunning ? "● Активные" : "○ Все"}
        </button>
        <span className="dim small">Сессий: {filtered.length}</span>
      </div>
      {filtered.length === 0 ? (
        <div className="empty">
          {onlyRunning ? "Нет активных сессий" : q ? "Ничего не найдено" : "Нет сессий"}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th style={{ cursor: "pointer" }} onClick={() => toggleSort("title")}>
                Сессия{mark("title")}
              </th>
              <th style={{ cursor: "pointer" }} onClick={() => toggleSort("session_type")}>
                Тип{mark("session_type")}
              </th>
              <th style={{ cursor: "pointer" }} onClick={() => toggleSort("total_tokens")}>
                Токены{mark("total_tokens")}
              </th>
              <th style={{ cursor: "pointer" }} onClick={() => toggleSort("running")}>
                Статус{mark("running")}
              </th>
              <th style={{ cursor: "pointer" }} onClick={() => toggleSort("updated_at")}>
                Обновлена{mark("updated_at")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr
                key={s.id}
                className={s.session_type === "sub_agent" ? "" : "session-row"}
                onClick={() => {
                  if (s.session_type !== "sub_agent") {
                    window.dispatchEvent(new CustomEvent("open-session", { detail: s.id }));
                  }
                }}
              >
                <td className="dim small" title={s.id}>
                  {s.id.length > 12 ? s.id.slice(0, 12) + "…" : s.id}
                </td>
                <td
                  className="session-open"
                  title={s.title || "Открыть в чате"}
                >
                  {s.title || "Без названия"}
                  {s.session_type !== "sub_agent" && <span className="session-open-hint">открыть ↗</span>}
                </td>
                <td className="dim">{s.session_type || "—"}</td>
                <td className="dim">{(s.total_tokens ?? 0).toLocaleString("ru")}</td>
                <td>
                  {s.running ? (
                    <span className="small">
                      <span className="chat-dot on" /> работает
                    </span>
                  ) : (
                    <span className="dim small">—</span>
                  )}
                </td>
                <td className="dim">{fmtDate(s.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function Recipes() {
  const [rows, setRows] = useState<RecipeRow[]>([]);
  useEffect(() => {
    listRecipes()
      .then((rs) =>
        setRows(
          [...rs].sort((a, b) =>
            (a.title || a.file).localeCompare(b.title || b.file, "ru")
          )
        )
      )
      .catch(() => setRows([]));
  }, []);

  return (
    <div className="page">
      <h1>Рецепты</h1>
      <p className="page-desc">
        Переиспользуемые конфигурации goose: инструкции, параметры, расширения.
      </p>
      {rows.length === 0 ? (
        <div className="empty">Рецептов нет — добавьте .yaml в ~/.config/goose/recipes</div>
      ) : (
        <div className="ext-grid">
          {rows.map((r) => (
            <div key={r.file} className="ext-card">
              <div className="ext-head">
                <div className="ext-name">{r.title || r.file}</div>
              </div>
              <div className="ext-desc">{r.description || "Без описания"}</div>
              <div className="ext-desc small" title={r.path}>
                {r.file}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
