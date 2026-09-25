/**
 * Scheduler — Планировщик: задания из ~/.local/share/goose/schedule.json
 * (ScheduledJob goose). Порт с Tauri/CSS на GPUIX: статусы строго из полей JSON
 * (currently_running / paused / cron), без магии; таблица → ряды div'ов.
 */
import { useEffect, useMemo, useState } from "react";
import { getScheduledJobs } from "../api/db";
import { copyText } from "../api/clipboard";
import { Icon } from "./Icon";
import { fs, type WaveTheme } from "../tokens";

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

/** SQLite/ISO → «23.09.2026, 14:05» */
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

function Dot(props: { color: string }) {
  return (
    <div
      style={{
        display: "flex",
        width: 8,
        height: 8,
        borderRadius: 99,
        flexShrink: 0,
        backgroundColor: props.color,
      }}
    />
  );
}

/** Статус из полей JSON: работающий / на паузе / расписание */
function statusOf(j: Job, t: WaveTheme): { label: string; color: string } {
  if (j.currently_running) return { label: "работающий", color: t.green };
  if (j.paused) return { label: "на паузе", color: t.gold };
  return { label: "расписание", color: t.faint };
}

export function Scheduler(props: { t: WaveTheme }) {
  const t = props.t;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    try {
      const js = (getScheduledJobs() ?? []) as Job[];
      setJobs(
        [...js].sort((a, b) => {
          // сначала работающие, затем обычные, затем на паузе; внутри — по id
          const rank = (j: Job) => (j.currently_running ? 0 : j.paused ? 2 : 1);
          const ra = rank(a);
          const rb = rank(b);
          if (ra !== rb) return ra - rb;
          return String(a.id ?? a.schedule_id ?? "").localeCompare(
            String(b.id ?? b.schedule_id ?? ""),
            "ru",
          );
        }),
      );
    } catch (e) {
      setErr(String(e).slice(0, 120));
    }
  }, []);

  const count = useMemo(
    () => ({
      run: jobs.filter((j) => j.currently_running).length,
      pause: jobs.filter((j) => j.paused && !j.currently_running).length,
    }),
    [jobs],
  );

  // имя / расписание / статус / сессия / последний запуск — фиксированные;
  // «Рецепт» забирает остаток строки
  const cols = [150, 140, 130, 100, 120];

  const headCell = (label: string, width: number) => (
    <text
      style={{
        fontSize: fs.xs,
        color: t.dim,
        fontWeight: 550,
        width,
        whiteSpace: "nowrap",
      }}
    >
      {`${label}`}
    </text>
  );

  const statusCell = (j: Job) => {
    const st = statusOf(j, t);
    return (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, width: cols[2] }}>
        <Dot color={st.color} />
        <text style={{ fontSize: fs.xs, color: st.color, whiteSpace: "nowrap" }}>
          {`${st.label}`}
        </text>
      </div>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        flexDirection: "column",
        padding: 24,
        overflowY: "scroll",
        backgroundColor: t.bg,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="clock" size={18} color={t.magenta} />
        <text style={{ fontSize: fs.xl, color: t.text, fontWeight: 650, whiteSpace: "nowrap" }}>
          Планировщик
        </text>
      </div>
      <text style={{ fontSize: fs.md, color: t.dim, marginTop: 6, marginBottom: 4 }}>
        Запланированные задания goose из ~/.local/share/goose/schedule.json:
        cron-расписание, рецепт и состояние.
      </text>

      {err ? (
        <div
          style={{
            display: "flex",
            backgroundColor: t.error + "1f",
            borderWidth: 1,
            borderColor: t.error,
            borderRadius: 13,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 10,
            paddingBottom: 10,
            marginTop: 8,
            marginBottom: 4,
          }}
        >
          <text style={{ fontSize: fs.sm, color: t.text }}>{`⚠ ${err}`}</text>
        </div>
      ) : null}

      {jobs.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 16,
            marginTop: 8,
            marginBottom: 8,
          }}
        >
          <text style={{ fontSize: fs.xs, color: t.dim, whiteSpace: "nowrap" }}>
            {`Всего: ${jobs.length}`}
          </text>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Dot color={t.green} />
            <text style={{ fontSize: fs.xs, color: t.text, whiteSpace: "nowrap" }}>
              {`работающих: ${count.run}`}
            </text>
          </div>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Dot color={t.gold} />
            <text style={{ fontSize: fs.xs, color: t.text, whiteSpace: "nowrap" }}>
              {`на паузе: ${count.pause}`}
            </text>
          </div>
        </div>
      ) : null}

      {jobs.length === 0 && !err ? (
        <text style={{ fontSize: fs.md, color: t.dim, marginTop: 12 }}>
          Нет запланированных заданий.
        </text>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          {/* шапка */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingBottom: 6,
              borderBottomWidth: 1,
              borderColor: t.border,
            }}
          >
            {headCell("Имя", cols[0])}
            <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minWidth: 120 }}>
              <text style={{ fontSize: fs.xs, color: t.dim, fontWeight: 550, whiteSpace: "nowrap" }}>
                Рецепт
              </text>
            </div>
            {headCell("Расписание", cols[1])}
            {headCell("Статус", cols[2])}
            {headCell("Сессия", cols[3])}
            {headCell("Последний запуск", cols[4])}
          </div>

          {jobs.map((j, i) => {
            const id = j.id ?? j.schedule_id ?? `#${i + 1}`;
            const cron = j.cron ?? j.cron_schedule ?? "—";
            const recipe = j.source ?? j.recipe ?? "—";
            const sid = j.current_session_id;
            const params =
              j.parameters && j.parameters.length > 0
                ? j.parameters.map(([k, v]) => `${k}=${v}`).join(", ")
                : "";
            return (
              <div
                key={`${id}-${i}`}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingTop: 6,
                  paddingBottom: 6,
                  borderBottomWidth: 1,
                  borderColor: t.border,
                }}
              >
                <text
                  style={{
                    fontSize: fs.md,
                    color: t.text,
                    width: cols[0],
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {`${id}`}
                </text>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flexGrow: 1,
                    flexShrink: 1,
                    minWidth: 0,
                  }}
                >
                  <text
                    style={{
                      fontSize: fs.md,
                      color: t.dim,
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {`${baseName(recipe)}`}
                  </text>
                  {params ? (
                    <text
                      style={{
                        fontSize: fs.xs2,
                        color: t.faint,
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {`${params}`}
                    </text>
                  ) : null}
                </div>
                <text
                  style={{
                    fontSize: fs.md,
                    color: t.dim,
                    width: cols[1],
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {`${cron}`}
                </text>
                {statusCell(j)}
                {sid ? (
                  <text
                    onClick={() => copyText(sid)}
                    style={{
                      fontSize: fs.xs,
                      color: t.dim,
                      width: cols[3],
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      cursor: "pointer",
                    }}
                  >
                    {`${sid.length > 12 ? sid.slice(0, 12) + "…" : sid}`}
                  </text>
                ) : (
                  <text style={{ fontSize: fs.xs, color: t.faint, width: cols[3], whiteSpace: "nowrap" }}>
                    —
                  </text>
                )}
                <text style={{ fontSize: fs.md, color: t.dim, width: cols[4], whiteSpace: "nowrap" }}>
                  {fmtDate(j.last_run)}
                </text>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Scheduler;
