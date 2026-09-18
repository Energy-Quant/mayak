// App — каркас паритета: сайдбар оригинала + страницы
import { useEffect, useState } from "react";
import Sidebar, { Page } from "./components/Sidebar";
import PantheonRoleBadge from "./components/PantheonRoleBadge";
import SplitPane from "./components/SplitPane";
import { Extensions } from "./components/Extensions";
import { Settings } from "./components/Settings";
import { History, Recipes } from "./components/SimplePages";
import { getRecentRuns } from "./api";

export default function App() {
  const [page, setPage] = useState<Page>("chat");
  const [subagentSession, setSubagentSession] = useState<string | null>(null);
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof getRecentRuns>>>([]);

  useEffect(() => {
    if (page === "chat") getRecentRuns().then(setRuns).catch(() => setRuns([]));
  }, [page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSubagentSession(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // TODO(MVP): ACP goose serve sidecar + @aaif/goose-acp-client; tool-call _meta.subagent_session_id → setSubagentSession

  return (
    <div className="app-shell">
      <Sidebar page={page} onNavigate={setPage} onOpenSession={() => setPage("chat")} />
      <SplitPane
        left={
          <div className="main-col">
            <header className="topbar">
              <PantheonRoleBadge role="goose" model="opencode_go/glm-5.3-flash" cost="MEDIUM" />
              {runs.length > 0 && (
                <span className="topbar-runs" title="активные личности (pantheon.db)">
                  {runs.filter((r) => r.status === "running").length > 0 &&
                    `● ${runs.filter((r) => r.status === "running").length} активны`}
                </span>
              )}
            </header>
            <main className="main-scroll">
              {page === "chat" && (
                <div className="chat-placeholder">
                  <div className="chat-placeholder-icon">🪿</div>
                  <div>ACP-чат появится здесь (goose serve sidecar + @aaif/goose-acp-client)</div>
                  <div className="dim small">Следующая итерация MVP</div>
                </div>
              )}
              {page === "extensions" && <Extensions />}
              {page === "history" && <History />}
              {page === "recipes" && <Recipes />}
              {page === "settings" && <Settings />}
              {page === "apps" && (
                <div className="page"><h1>Приложения</h1><div className="empty">MCP-приложения — следующая итерация паритета</div></div>
              )}
              {page === "scheduler" && (
                <div className="page"><h1>Планировщик</h1><div className="empty">Расписания рецептов — следующая итерация паритета</div></div>
              )}
            </main>
          </div>
        }
        right={subagentSession ? <div className="page">Сессия субагента: {subagentSession}</div> : undefined}
        onCloseRight={() => setSubagentSession(null)}
      />
    </div>
  );
}
