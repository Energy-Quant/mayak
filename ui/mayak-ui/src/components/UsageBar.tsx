/**
 * UsageBar — линейный бар лимитов OpenCode Go (5ч/нед/мес), опрос 30с.
 * Данные: api/limits.getOpencodeUsage (порт get_opencode_usage).
 */
import { useEffect, useState } from "react";
import { getOpencodeUsage, type UsageReport, type UsageWindow } from "../api/limits";
import { fs, type WaveTheme } from "../tokens";

function level(p: number): "" | "warn" | "crit" {
  if (p >= 90) return "crit";
  if (p >= 70) return "warn";
  return "";
}

function fmtReset(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.max(0, Math.round((d.getTime() - Date.now()) / 60000));
  if (mins < 60) return `через ${mins} мин`;
  const h = Math.round(mins / 60);
  if (h < 48) return `через ${h} ч`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function Seg(props: { label: string; w?: UsageWindow; t: WaveTheme }) {
  const t = props.t;
  const p = props.w?.percent ?? 0;
  const lvl = level(p);
  const fill = lvl === "crit" ? t.error : lvl === "warn" ? t.gold : t.green;
  return (
    <div
      style={{display: "flex",  flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1 }}
    >
      <text style={{ fontSize: fs.xs2, color: t.dim, width: 46 }}>{props.label}</text>
      <div
        style={{display: "flex", flexDirection: "column", 
          flexGrow: 1,
          height: 4,
          borderRadius: 99,
          backgroundColor: t.glass,
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${p}%`, height: 4, borderRadius: 99, backgroundColor: fill }} />
      </div>
      <text
        style={{
          fontSize: fs.xs2,
          width: 36,
          textAlign: "right",
          fontWeight: 650,
          color: lvl === "crit" ? t.error : t.text,
        }}
      >
        {p}%
      </text>
    </div>
  );
}

export default function UsageBar(props: { t: WaveTheme; refreshKey?: number }) {
  const [u, setU] = useState<UsageReport | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () =>
      getOpencodeUsage()
        .then((r) => {
          if (alive) {
            setU(r);
            setErr("");
          }
        })
        .catch((e) => {
          if (alive) setErr(String(e).slice(0, 80));
        });
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // после каждого нового сообщения — сразу обновить лимиты
  useEffect(() => {
    if (props.refreshKey) getOpencodeUsage().then(setU).catch(() => {});
  }, [props.refreshKey]);

  if (err && !u) {
    return (
      <text
        style={{
          fontSize: fs.xs2,
          color: props.t.faint,
          paddingLeft: 26,
          paddingRight: 26,
          paddingBottom: 12,
        }}
      >
        лимиты OpenCode Go: {err}
      </text>
    );
  }

  return (
    <div
      style={{display: "flex", 
        flexDirection: "row",
        gap: 18,
        paddingLeft: 26,
        paddingRight: 26,
        paddingBottom: 12,
      }}
    >
      <Seg label="5ч" w={u?.rolling} t={props.t} />
      <Seg label="Нед" w={u?.weekly} t={props.t} />
      <Seg label="Месяц" w={u?.monthly} t={props.t} />
    </div>
  );
}
