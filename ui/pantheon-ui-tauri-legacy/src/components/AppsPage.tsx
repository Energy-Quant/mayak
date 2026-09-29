// AppsPage — Приложения: HTML-приложения из ~/.local/share/goose/apps
import { useEffect, useState } from "react";
import { getStoredApps, openApp } from "../api";

export default function AppsPage() {
  const [apps, setApps] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    getStoredApps()
      .then((list) => setApps([...list].sort((a, b) => a.localeCompare(b, "ru"))))
      .catch((e) => setErr(String(e).slice(0, 120)));
  }, []);

  const launch = (name: string) => {
    setBusy(name);
    setErr("");
    openApp(name)
      .catch((e) => setErr(String(e).slice(0, 120)))
      .finally(() => setBusy(""));
  };

  return (
    <div className="page">
      <h1>Приложения</h1>
      <p className="page-desc">
        HTML-приложения из хранилища goose (~/.local/share/goose/apps). Кнопка «Открыть» запускает
        файл в системном браузере.
      </p>
      {err && <div className="error-banner">⚠ {err}</div>}
      {apps.length === 0 && !err ? (
        <div className="empty">Приложений нет — они появятся, когда goose создаст их в чате.</div>
      ) : (
        <div className="ext-grid">
          {apps.map((a) => (
            <div key={a} className="ext-card">
              <div className="ext-head">
                <div className="ext-name">{a}</div>
                <button className="primary" disabled={busy === a} onClick={() => launch(a)}>
                  {busy === a ? "…" : "Открыть"}
                </button>
              </div>
              <div className="ext-desc">~/.local/share/goose/apps/{a}.html</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
