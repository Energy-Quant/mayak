// Scheduler — вкладка Планировщик: jobs из schedule.json (goose scheduler)
import { useEffect, useState } from "react";
import { getScheduledJobs } from "../api";

export default function Scheduler() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    getScheduledJobs().then(setJobs).catch((e) => setErr(String(e).slice(0, 120)));
  }, []);

  return (
    <div className="page">
      <h2>Планировщик</h2>
      <div className="page-hint">Запланированные задания goose (~/.local/share/goose/schedule.json).</div>
      {err && <div className="error-banner">⚠ {err}</div>}
      {jobs.length === 0 && !err && (
        <div className="empty">Нет запланированных заданий.</div>
      )}
      {jobs.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Имя</th><th>Рецепт</th><th>Расписание</th><th>Состояние</th></tr>
            </thead>
            <tbody>
              {jobs.map((j, i) => (
                <tr key={i}>
                  <td>{j.name ?? j.id ?? "—"}</td>
                  <td className="dim">{j.recipe_path ?? j.recipe ?? "—"}</td>
                  <td className="dim mono">{j.cron ?? j.schedule ?? ((j.source === 'recipe' && j.source_details) ? j.source_details : '—')}</td>
                  <td>{j.currently_running ? <span className="chat-dot on" /> : <span className="chat-dot" />} {j.currently_running ? "выполняется" : "ожидание"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
