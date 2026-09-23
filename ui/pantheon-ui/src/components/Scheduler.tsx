// Scheduler — Планировщик: задания из ~/.local/share/goose/schedule.json (ScheduledJob goose)
import { useEffect, useMemo, useState } from "react";
import { getScheduledJobs } from "../api";

/** Поля ScheduledJob (crates/goose/src/scheduler.rs) + устойчивость к альт. именам */
interface Job {
  id?: string;
  schedule_id?: string;
  source?: string;
  recipe?: string;
  cron?: string;
  cron_schedule?: string;
  last_run?: string | null;
  currently_running?: boolean;
  paused?: boolean;
  current_session_id?: string | null;
  process_start_time?: string | null;
  parameters?: [string, string][];
  recipe_base_dir?: string | null;
}

function fmtDate(s?: string | null): string {
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

function baseName(p?: string): string {
  if (!p) return "—";
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

export default function Scheduler() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    getScheduledJobs()
      .then((js: Job[]) =>
        setJobs(
          [...(js ?? [])].sort((a, b) => {
            // сначала работающие, затем на паузе, затем остальные; внутри — по id
            const rank = (j: Job) => (j.currently_running ? 0 : j.paused ? 2 : 1);
            const ra = rank(a);
            const rb = rank(b);
            if (ra !== rb) return ra - rb;
            return String(a.id ?? a.schedule_id ?? "").localeCompare(
              String(b.id ?? b.schedule_id ?? ""),
              "ru"
            );
          })
        )
      )
      .catch((e) => setErr(String(e).slice(0, 120)));
  }, []);

  const count = useMemo(
    () => ({
      run: jobs.filter((j) => j.currently_running).length,
      pause: jobs.filter((j) => j.paused && !j.currently_running).length,
    }),
    [jobs]
  );

  const statusOf = (j: Job) => {
    if (j.currently_running)
      return (
        <span className="small">
          <span className="chat-dot on" /> работающий
        </span>
      );
    if (j.paused)
      return (
        <span className="small">
          <span className="chat-dot" /> на паузе
        </span>
      );
    return (
      <span className="small dim">
        <span className="chat-dot" /> расписание
      </span>
    );
  };

  return (
    <div className="page">
      <h1>Планировщик</h1>
      <p className="page-desc">
        Запланированные задания goose из ~/.local/share/goose/schedule.json: cron-расписание,
        рецепт и состояние.
      </p>
      {err && <div className="error-banner">⚠ {err}</div>}
      {jobs.length > 0 && (
        <div className="row-actions">
          <span className="dim small">Всего: {jobs.length}</span>
          <span className="small">
            <span className="chat-dot on" /> работающих: {count.run}
          </span>
          <span className="small">
            <span className="chat-dot" /> на паузе: {count.pause}
          </span>
        </div>
      )}
      {jobs.length === 0 && !err ? (
        <div className="empty">Нет запланированных заданий.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Имя</th>
              <th>Рецепт</th>
              <th>Расписание</th>
              <th>Статус</th>
              <th>Сессия</th>
              <th>Последний запуск</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j, i) => {
              const id = j.id ?? j.schedule_id ?? `#${i + 1}`;
              const cron = j.cron ?? j.cron_schedule ?? "—";
              const recipe = j.source ?? j.recipe ?? "—";
              return (
                <tr key={id + i}>
                  <td title={id}>{id}</td>
                  <td className="dim" title={recipe}>
                    {baseName(recipe)}
                    {j.parameters && j.parameters.length > 0 && (
                      <div className="small dim">
                        {j.parameters.map(([k, v]) => `${k}=${v}`).join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="dim">{cron}</td>
                  <td>{statusOf(j)}</td>
                  <td className="dim small" title={j.current_session_id ?? undefined}>
                    {j.current_session_id
                      ? j.current_session_id.length > 12
                        ? j.current_session_id.slice(0, 12) + "…"
                        : j.current_session_id
                      : "—"}
                  </td>
                  <td className="dim">{fmtDate(j.last_run)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
