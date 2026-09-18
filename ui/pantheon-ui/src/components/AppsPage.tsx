// AppsPage — вкладка Приложения: HTML-приложения из ~/.local/share/goose/apps
import { useEffect, useState } from "react";
import { getStoredApps, openApp } from "../api";

export default function AppsPage() {
  const [apps, setApps] = useState<string[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    getStoredApps().then(setApps).catch((e) => setErr(String(e).slice(0, 100)));
  }, []);

  return (
    <div className="page">
      <h2>Приложения</h2>
      <div className="page-hint">Приложения из хранилища MCP-сервера goose (HTML). Кнопка «Запустить» открывает в системном браузере.</div>
      {err && <div className="error-banner">⚠ {err}</div>}
      {apps.length === 0 && !err && <div className="empty">Нет приложений — они появятся, когда goose создаст их в чате.</div>}
      <div className="apps-grid">
        {apps.map((a) => (
          <div key={a} className="app-card">
            <div className="app-title">{a}</div>
            <button onClick={() => openApp(a).catch((e) => setErr(String(e).slice(0, 100)))}>▶ Запустить</button>
          </div>
        ))}
      </div>
    </div>
  );
}
