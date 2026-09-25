/**
 * App — каркас: сайдбар + страницы + split-view субагента.
 * Без window-событий: навигация и pending-сессия — React-state.
 * Тема (mode) живёт здесь и спускается пропсом t.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Sidebar, { type Page } from "./components/Sidebar";
import SubagentStream from "./components/SubagentStream";
import SplitPane from "./components/SplitPane";
import { ChatPage } from "./components/Chat";
import { autoTheme, dark, light, type ThemeMode, type WaveTheme } from "./tokens";
import { winKeys } from "./windowKeys";

// Страницы шага 7 — временные заглушки ( заменяются на полные порты )
function StubPage(props: { title: string; t: WaveTheme }) {
  return (
    <div style={{display: "flex",  padding: 24, flexDirection: "column", gap: 8 }}>
      <text style={{ fontSize: 20, color: props.t.text, fontWeight: 650 }}>{props.title}</text>
      <text style={{ fontSize: 13.5, color: props.t.dim }}>
        Страница будет перенесена на GPUIX на шаге 7 плана Phase 4.
      </text>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = globalThis.localStorage?.getItem("mayak-theme");
    if (saved === "light" || saved === "dark") return saved;
    return autoTheme();
  });
  const t: WaveTheme = mode === "light" ? light : dark;

  const [page, setPage] = useState<Page>("chat");
  const [subagentSession, setSubagentSession] = useState<string | null>(null);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const [sidebarW, setSidebarW] = useState<number>(
    () => +(globalThis.localStorage?.getItem("mayak-sidebar-w") ?? 236),
  );
  const [railW, setRailW] = useState<number>(
    () => +(globalThis.localStorage?.getItem("mayak-rail-w") ?? 264),
  );
  const setSidebar = useCallback((w: number) => {
    setSidebarW(w);
    globalThis.localStorage?.setItem("mayak-sidebar-w", String(w));
  }, []);
  const setRail = useCallback((w: number) => {
    setRailW(w);
    globalThis.localStorage?.setItem("mayak-rail-w", String(w));
  }, []);

  useEffect(() => {
    globalThis.localStorage?.setItem("mayak-theme", mode);
  }, [mode]);

  const onOpenSubagent = useCallback((id: string) => setSubagentSession(id), []);
  const clearPending = useCallback(() => setPendingSession(null), []);

  // Esc → закрыть панель субагента; Ctrl+T → переключить тему (dev-переключатель)
  useEffect(() => {
    winKeys.handler = (e) => {
      if (e.key === "escape") setSubagentSession(null);
      if (e.key === "t" && e.modifiers?.ctrl) {
        setMode((m) => (m === "dark" ? "light" : "dark"));
      }
    };
    return () => {
      winKeys.handler = null;
    };
  }, []);

  const openSession = useCallback((id: string) => {
    setPage("chat");
    setPendingSession(id);
  }, []);

  let content: ReactNode;
  switch (page) {
    case "chat":
      content = (
        <ChatPage
          railWidth={railW}
          onRailWidth={setRail}
          t={t}
          onOpenSubagent={onOpenSubagent}
          pendingSession={pendingSession}
          clearPending={clearPending}
        />
      );
      break;
    case "extensions":
      content = <StubPage title="Расширения" t={t} />;
      break;
    case "history":
      content = <StubPage title="История сессий" t={t} />;
      break;
    case "recipes":
      content = <StubPage title="Рецепты" t={t} />;
      break;
    case "settings":
      content = <StubPage title="Настройки" t={t} />;
      break;
    case "apps":
      content = <StubPage title="Приложения" t={t} />;
      break;
    case "scheduler":
      content = <StubPage title="Планировщик" t={t} />;
      break;
    case "pantheon":
      content = <StubPage title="Панель Маяка" t={t} />;
      break;
    case "chains":
      content = <StubPage title="Цепочки агентов" t={t} />;
      break;
  }

  return (
    <div style={{display: "flex",  height: "100%", backgroundColor: t.bg, flexDirection: "row", flexGrow: 1 }}>
      <Sidebar
        page={page}
        onNavigate={setPage}
        onOpenSession={openSession}
        width={sidebarW}
        onWidth={setSidebar}
        t={t}
      />
      <SplitPane
        left={content}
        right={
          subagentSession ? (
            <div
              style={{display: "flex", 
                flexDirection: "column",
                height: "100%",
                paddingLeft: 16,
                paddingRight: 16,
                paddingTop: 8,
                paddingBottom: 12,
              }}
            >
              <div
                style={{display: "flex", 
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  padding: 8,
                  marginBottom: 8,
                }}
              >
                <div
                  onClick={() => setSubagentSession(null)}
                  style={{display: "flex", flexDirection: "column", 
                    width: 26,
                    height: 26,
                    borderRadius: 9,
                    borderWidth: 1,
                    borderColor: t.border,
                    backgroundColor: t.glass,
                    justifyContent: "center",
                    alignItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <text style={{ color: t.dim, fontSize: 12 }}>✕</text>
                </div>
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: t.green,
                  }}
       />
                <text style={{display: "flex", flexDirection: "column",  fontSize: 13.5, color: t.text, flexGrow: 1 }}>
                  Субагент · session {subagentSession.slice(0, 20)}
                </text>
                <text style={{ fontSize: 11.5, color: t.faint }}>live-стрим</text>
              </div>
              <SubagentStream sessionId={subagentSession} t={t} />
            </div>
          ) : undefined
        }
        onCloseRight={() => setSubagentSession(null)}
        hoverColor={t.magenta + "66"}
        buttonBg={t.glass}
        buttonText={t.dim}
        borderColor={t.border}
      />
    </div>
  );
}
