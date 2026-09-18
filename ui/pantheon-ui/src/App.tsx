// App — каркас: шапка с бейджем, вкладки Чат / Пантеон / Настройки, split-view
import { useEffect, useState } from "react";
import PantheonRoleBadge from "./components/PantheonRoleBadge";
import AgentSettings from "./components/AgentSettings";
import SplitPane from "./components/SplitPane";
import { getRecentRuns } from "./api";

type Tab = "chat" | "pantheon" | "settings";

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const [subagentSession, setSubagentSession] = useState<string | null>(null);
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof getRecentRuns>>>([]);

  useEffect(() => {
    if (tab === "pantheon") getRecentRuns().then(setRuns).catch(() => setRuns([]));
  }, [tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSubagentSession(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // TODO(Phase 2): ACP-подключение через @aaif/goose-acp-client к goose serve (sidecar),
  // подписка на tool-call события с _meta.subagent_session_id → setSubagentSession(...)

  return (
    <SplitPane
      left={
        <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
            <PantheonRoleBadge role="goose" model="opencode_go/glm-5.3-flash" cost="MEDIUM" fallbackFired={undefined} />
            <nav style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              {(["chat", "pantheon", "settings"] as Tab[]).map((t) => (
                <button key={t} onClick={() => setTab(t)} style={t === tab ? { borderColor: "var(--accent-violet)" } : undefined}>
                  {t === "chat" ? "Чат" : t === "pantheon" ? "Пантеон" : "Настройки"}
                </button>
              ))}
            </nav>
          </header>
          <main style={{ flex: 1, overflowY: "auto" }}>
            {tab === "chat" && (
              <div style={{ padding: 16, color: "var(--text-dim)" }}>
                ACP-чат появится здесь (goose serve sidecar + @aaif/goose-acp-client).
              </div>
            )}
            {tab === "pantheon" && (
              <div style={{ padding: 16 }}>
                <h2>Пантеон</h2>
                <h3>Личности</h3>
                <ul style={{ listStyle: "none", padding: 0 }}>
                  {runs.map((r) => (
                    <li key={r.session_id} className="chain-card" style={{ padding: 10 }}>
                      <PantheonRoleBadge role={r.role} model={r.model} />
                      <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 6 }}>
                        {r.task_summary || "—"} · {r.status}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tab === "settings" && <AgentSettings />}
          </main>
        </div>
      }
      right={subagentSession ? <div style={{ padding: 16 }}>Сессия субагента: {subagentSession}</div> : undefined}
      onCloseRight={() => setSubagentSession(null)}
    />
  );
}
