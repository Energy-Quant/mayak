// UsageBar — линейный бар лимитов OpenCode Go под полем ввода: 5 часов / неделя / месяц.
// Данные: GET /zen/go/v1/usage (tauri-команда get_opencode_usage), опрос 30с + сразу после отправки.
import { useEffect, useState } from "react";
import { getOpenCodeUsage, UsageWindow } from "../api";

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

function Seg(props: { label: string; w?: UsageWindow }) {
  const p = props.w?.percent ?? 0;
  const title = props.w?.resetsAt ? `сброс ${fmtReset(props.w.resetsAt)}` : "";
  return (
    <div className={`usage-seg ${level(p)}`} title={title}>
      <span className="usage-label">{props.label}</span>
      <div className="usage-track">
        <div className="usage-fill" style={{ width: `${p}%` }} />
      </div>
      <b className="usage-pct">{p}%</b>
    </div>
  );
}

export default function UsageBar(props: { refreshKey?: number }) {
  const [u, setU] = useState<{ rolling: UsageWindow; weekly: UsageWindow; monthly: UsageWindow } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () =>
      getOpenCodeUsage()
        .then((r) => { if (alive) { setU(r); setErr(""); } })
        .catch((e) => { if (alive) setErr(String(e).slice(0, 80)); });
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // реальное время: после каждого нового сообщения в чате обновляем лимиты
  useEffect(() => {
    if (props.refreshKey) getOpenCodeUsage().then(setU).catch(() => {});
  }, [props.refreshKey]);

  if (err && !u) return <div className="usage-bar usage-empty">лимиты OpenCode Go: {err}</div>;

  return (
    <div className="usage-bar" aria-label="Лимиты подписки OpenCode Go">
      <Seg label="5ч" w={u?.rolling} />
      <Seg label="Нед" w={u?.weekly} />
      <Seg label="Месяц" w={u?.monthly} />
    </div>
  );
}
