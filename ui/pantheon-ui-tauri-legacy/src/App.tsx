// App — каркас паритета: титлбар + сайдбар + страницы
import { useEffect, useState } from "react";
import Sidebar, { Page } from "./components/Sidebar";
import SubagentStream from "./components/SubagentStream";
import Scheduler from "./components/Scheduler";
import AppsPage from "./components/AppsPage";
import SplitPane from "./components/SplitPane";
import { Extensions } from "./components/Extensions";
import { Settings } from "./components/Settings";
import { History, Recipes } from "./components/SimplePages";
import { ChatPage } from "./components/Chat";
import PantheonPanel from "./components/PantheonPanel";
import ChainEditor from "./components/ChainEditor";

export default function App() {
  const [page, setPage] = useState<Page>("chat");
  const [subagentSession, setSubagentSession] = useState<string | null>(null);
  // динамический ресайз панелей (как в оригинальном Goose — тянем за границу)
  const [sidebarW, setSidebarW] = useState<number>(() => +(localStorage.getItem("pantheon-sidebar-w") ?? 236));
  const [railW, setRailW] = useState<number>(() => +(localStorage.getItem("pantheon-rail-w") ?? 264));
  const setSidebar = (w: number) => { setSidebarW(w); localStorage.setItem("pantheon-sidebar-w", String(w)); };
  const setRail = (w: number) => { setRailW(w); localStorage.setItem("pantheon-rail-w", String(w)); };

  useEffect(() => {
    (window as any).__pantheon_nav = (p: string) => setPage(p as Page);
    // иерархия: drill-down субагента в правую панель из tool-call'ов и rail-списка
    const onOpenSub = (e: Event) => setSubagentSession((e as CustomEvent).detail as string);
    window.addEventListener("open-subagent", onOpenSub as EventListener);
    // История → чат: открыть выбранную сессию и переключить страницу.
    // ВАЖНО: НЕ переиспускаем "open-session" (петля на самовлове) — целевой
    // слушатель в ChatPage слушает другое имя: "load-session".
    const onOpenSession = (e: Event) => {
      setPage("chat");
      (window as any).__pantheon_pending_session = (e as CustomEvent).detail as string;
      setTimeout(() => window.dispatchEvent(new CustomEvent("load-session", { detail: (e as CustomEvent).detail })), 60);
    };
    window.addEventListener("open-session", onOpenSession as EventListener);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSubagentSession(null);
      if ((e.ctrlKey || e.metaKey) && ["1","2","3","4","5","6","7"].includes(e.key)) {
        e.preventDefault();
        const order: Page[] = ["chat","recipes","settings","apps","extensions","scheduler","history"];
        setPage(order[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("open-subagent", onOpenSub as EventListener);
    window.removeEventListener("open-session", onOpenSession as EventListener);
    delete (window as any).__pantheon_pending_session;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // TODO(MVP): ACP goose serve sidecar + @aaif/goose-acp-client; tool-call _meta.subagent_session_id → setSubagentSession

  return (
    <div className="app-shell">
      <div className="app-body">
      <Sidebar
        page={page}
        onNavigate={setPage}
        onOpenSession={(id: string) => {
          setPage("chat");
          (window as any).__pantheon_pending_session = id;
          setTimeout(() => window.dispatchEvent(new CustomEvent("load-session", { detail: id })), 60);
        }}
        width={sidebarW}
        onWidth={setSidebar}
      />
      <SplitPane
        left={
          <div className="main-col">
            <main className="main-scroll chat-host">
              {page === "chat" && <ChatPage railWidth={railW} onRailWidth={setRail} />}
              {page === "extensions" && <Extensions />}
              {page === "history" && <History />}
              {page === "recipes" && <Recipes />}
              {page === "settings" && <Settings />}
              {page === "apps" && <AppsPage />}
              {page === "scheduler" && <Scheduler />}
              {page === "pantheon" && <PantheonPanel />}
              {page === "chains" && <ChainEditor />}
            </main>
          </div>
        }
        right={
          subagentSession ? (
            <div className="subagent-view">
              <div className="subagent-view-head">
                <button
                  className="subagent-close"
                  onClick={() => setSubagentSession(null)}
                  title="Закрыть (Esc)"
                  aria-label="Закрыть панель субагента"
                >✕</button>
                <span className="chat-dot on" />
                <span className="subagent-view-title">Субагент · session {subagentSession}</span>
                <small className="dim"> live-стрим из sessions.db</small>
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
