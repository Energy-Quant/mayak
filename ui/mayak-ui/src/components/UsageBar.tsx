/**
 * UsageBar — linear bar for OpenCode Go limits (5h/week/month), 30s poll.
 * Data: api/limits.getOpencodeUsage (port of get_opencode_usage).
 */
import { useEffect, useState } from "react";
import { getOpencodeUsage, type UsageReport, type UsageWindow } from "../api/limits";
import { fs, type WaveTheme } from "../tokens";
import { log } from "../logger";

function level(p: number): "" | "warn" | "crit" {
  if (p >= 90) return "crit";
  if (p >= 70) return "warn";
  return "";
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
      <text style={{ fontSize: fs.xs2, color: t.dim, width: 46, whiteSpace: "nowrap" }}>{props.label}</text>
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
          width: 40,
          textAlign: "right",
          fontWeight: 650,
          whiteSpace: "nowrap",
          color: lvl === "crit" ? t.error : t.text,
        }}
      >
        {`${p}%`}
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
          log.warn("usageBar.load", String(e).slice(0, 160));
          if (alive) setErr(String(e).slice(0, 80));
        });
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // Single fetch loop: on mount, after every new message (refreshKey) and every 30s.
    // `alive` guards setState after unmount; failures are logged and shown in the bar.
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
        width: "100%",
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
