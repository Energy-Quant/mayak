// SubagentStream — split-view live-стрим субагента.
// Реализация (v2): goose в реальном времени пишет сообщения субагента в sessions.db —
// опрос 2с даёт живой поток. ACP-стрим субагента (отдельный ws + session/load) — следующий шаг.
import { useEffect, useRef, useState } from "react";
import { isTauri, safeInvoke } from "../acp";

interface Update {
  t: string; // текст события
}

export default function SubagentStream({ sessionId }: { sessionId: string }) {
  const [events, setEvents] = useState<Update[]>([]);
  const [err, setErr] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    // MVP: события субагента летят в общий поток родителя (subagent_session_id их уже различает).
    // Здесь — локальный tail из sessions.db (последние сообщения субагента) как оффлайн-вид.
    (async () => {
      if (!isTauri()) { setErr("не в Tauri"); return; }
      try {
        const rows = await safeInvoke<any[]>("list_subagent_messages", { sessionId });
        if (alive) setEvents(rows.map((r: any) => ({ t: `[${r.role}] ${String(r.content).slice(0, 300)}` })));
      } catch (e) { if (alive) setErr(String(e).slice(0, 100)); }
    })();
    const t = setInterval(async () => {
      try {
        const rows = await safeInvoke<any[]>("list_subagent_messages", { sessionId });
        if (alive) setEvents(rows.map((r: any) => ({ t: `[${r.role}] ${String(r.content).slice(0, 300)}` })));
      } catch { /* тихо */ }
    }, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [sessionId]);

  useEffect(() => { boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight }); }, [events.length]);

  return (
    <div className="subagent-stream" ref={boxRef}>
      {err && <div className="error-banner">⚠ {err}</div>}
      {events.map((e, i) => <div key={i} className="subagent-msg">{e.t}</div>)}
      {events.length === 0 && !err && <div className="dim small">Ждём сообщения субагента…</div>}
    </div>
  );
}
