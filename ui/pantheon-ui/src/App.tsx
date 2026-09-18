// App — каркас паритета: титлбар + сайдбар + страницы
import { useEffect, useState } from "react";
import Sidebar, { Page } from "./components/Sidebar";
import TitleBar from "./components/TitleBar";
import SubagentStream from "./components/SubagentStream";
import Scheduler from "./components/Scheduler";
import AppsPage from "./components/AppsPage";
import SplitPane from "./components/SplitPane";
import { Extensions } from "./components/Extensions";
import { Settings } from "./components/Settings";
import { History, Recipes } from "./components/SimplePages";
import { ChatPage } from "./components/Chat";

export default function App() {
  const [page, setPage] = useState<Page>("chat");
  const [subagentSession, setSubagentSession] = useState<string | null>(null);

  useEffect(() => {
    (window as any).__pantheon_nav = (p: string) => setPage(p as Page);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSubagentSession(null);
      if ((e.ctrlKey || e.metaKey) && ["1","2","3","4","5","6","7"].includes(e.key)) {
        e.preventDefault();
        const order: Page[] = ["chat","recipes","settings","apps","extensions","scheduler","history"];
        setPage(order[Number(e.key) - 1]);
      }
    };
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
              {page === "apps" && <AppsPage />}
              {page === "scheduler" && <Scheduler />}
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
