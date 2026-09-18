// App — каркас паритета: титлбар + сайдбар + страницы
import { useEffect, useState } from "react";
import Sidebar, { Page } from "./components/Sidebar";
import TitleBar from "./components/TitleBar";
import SubagentStream from "./components/SubagentStream";
import SplitPane from "./components/SplitPane";
import { Extensions } from "./components/Extensions";
import { Settings } from "./components/Settings";
import { History, Recipes } from "./components/SimplePages";
import { ChatPage } from "./components/Chat";

export default function App() {
  const [page, setPage] = useState<Page>("chat");
  const [subagentSession, setSubagentSession] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSubagentSession(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // TODO(MVP): ACP goose serve sidecar + @aaif/goose-acp-client; tool-call _meta.subagent_session_id → setSubagentSession

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="app-body">
      <Sidebar page={page} onNavigate={setPage} onOpenSession={() => setPage("chat")} />
      <SplitPane
        left={
          <div className="main-col">
            <main className="main-scroll chat-host">
              {page === "chat" && <ChatPage />}
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
        right={
          subagentSession ? (
            <div className="subagent-view">
              <div className="subagent-view-head">
                <span className="chat-dot on" /> Субагент · session {subagentSession}
                <small className="dim"> (live-стрим придёт с ACP-событиями этой сессии)</small>
              </div>
              <SubagentStream sessionId={subagentSession} />
            </div>
          ) : undefined
        }
        onCloseRight={() => setSubagentSession(null)}
      />
      </div>
    </div>
  );
}
