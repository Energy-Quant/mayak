/**
 * Sidebar — navigation + chat list (port without DOM; resize via pointer capture).
 */
import { useEffect, useState } from "react";
import { listSessions, type SessionRow } from "../api/db";
import { Icon, type IconName } from "./Icon";
import { useDragWidth } from "../useDragWidth";
import { fs, sp, type WaveTheme } from "../tokens";
import { log } from "../logger";

export type Page =
  | "chat"
  | "recipes"
  | "extensions"
  | "scheduler"
  | "history"
  | "apps"
  | "settings"
  | "pantheon"
  | "chains";

const NAV: { id: Page; label: string; icon: IconName }[] = [
  { id: "recipes", label: "Рецепты", icon: "clipboard" },
  { id: "settings", label: "Настройки", icon: "settings" },
  { id: "apps", label: "Приложения", icon: "app" },
  { id: "extensions", label: "Расширения", icon: "puzzle" },
  { id: "scheduler", label: "Планировщик", icon: "clock" },
  { id: "history", label: "История сессий", icon: "history" },
  { id: "chains", label: "Цепочки агентов", icon: "clipboard" },
];

export default function Sidebar(props: {
  page: Page;
  onNavigate: (p: Page) => void;
  onOpenSession: (id: string) => void;
  /** real "New chat" action (reset + new session), not navigation */
  onNewChat: () => void;
  /** highlight of the open chat row */
  activeSessionId: string | null;
  width: number;
  onWidth: (w: number) => void;
  t: WaveTheme;
}) {
  const t = props.t;
  const drag = useDragWidth(() => props.width, props.onWidth, { min: 180, max: 420 });
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [hoverIdx, setHoverIdx] = useState(-1);

  useEffect(() => {
    const load = () => {
      try {
        setSessions(
          // Hierarchy: only top-level chats on the left; sub_agent/hidden/gateway and children go inside
          listSessions(false).filter(
            (s) =>
              !["sub_agent", "hidden", "gateway"].includes(s.session_type) &&
              !s.parent_session_id &&
              // empty spam sessions "New Chat" (0 tokens) from reconnects — hidden
              !(s.title === "New Chat" && s.total_tokens === 0),
          ),
        );
      } catch (e) { log.debug("ui.error", String(e));
        setSessions([]);
      }
    };
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  const navItem = (
    n: { id: Page; label: string; icon: IconName },
    bottom = false,
    isActive?: boolean,
    onClick?: () => void,
  ) => {
    const active = isActive ?? props.page === n.id;
    return (
      <div
        key={`${n.id}${bottom ? "-bottom" : ""}`}
        onClick={onClick ?? (() => props.onNavigate(n.id))}
        style={{display: "flex", 
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 12,
          paddingRight: 12,
          borderRadius: 13,
          borderWidth: 1,
          borderColor: active ? t.borderStrong : "transparent",
          backgroundColor: active ? t.navActive : "transparent",
          cursor: "pointer",
          marginBottom: 3,
        }}
        onMouseEnter={() => setHoverIdx(-2)}
        onMouseLeave={() => setHoverIdx(-1)}
      >
        <Icon name={n.icon} size={16} color={active ? t.magenta : t.dim} />
        <text style={{ fontSize: fs.md, color: active ? t.text : t.dim }}>{n.label}</text>
      </div>
    );
  };

  return (
    <div
      style={{display: "flex", 
        width: props.width,
        minWidth: props.width,
        flexDirection: "column",
        backgroundColor: t.bg,
        borderRightWidth: 1,
        borderColor: t.borderStrong,
        paddingTop: sp[3],
        paddingBottom: sp[3],
        paddingLeft: 10,
        paddingRight: 10,
        position: "relative",
      }}
    >
      <div style={{ paddingLeft: 10, paddingRight: 10, paddingBottom: sp[3] }}>
        <text style={{ fontSize: 20, color: t.magenta }}>🪿</text>
      </div>
      <div style={{display: "flex",  flexDirection: "column" }}>
        {navItem(
          { id: "chat", label: "Новый чат", icon: "plus" },
          false,
          props.page === "chat" && props.activeSessionId === null,
          props.onNewChat,
        )}
        {NAV.map((n) => navItem(n))}
      </div>

      <text
        style={{
          fontSize: fs.xs2,
          color: t.faint,
          marginTop: sp[4],
          marginBottom: sp[2],
          paddingLeft: 12,
          paddingTop: sp[3],
          borderTopWidth: 1,
        }}
      >
        ЧАТЫ
      </text>

      <div style={{display: "flex",  flexDirection: "column", gap: 1, flexGrow: 1, overflowY: "auto" }}>
        {sessions.map((s, i) => (
          <div
            key={s.id}
            onClick={() => props.onOpenSession(s.id)}
            style={{display: "flex", 
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
              paddingTop: 7,
              paddingBottom: 7,
              paddingLeft: 12,
              paddingRight: 12,
              borderRadius: 9,
              cursor: "pointer",
              backgroundColor:
                s.id === props.activeSessionId
                  ? t.navActive
                  : hoverIdx === i
                    ? t.glass
                    : "transparent",
            }}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(-1)}
          >
            <div
     style={{display: "flex", flexDirection: "column", 
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: s.running ? t.green : t.faint,
                flexShrink: 0,
              }}
            />
            <text
              style={{display: "flex", flexDirection: "column",
                fontSize: fs.sm,
                color: t.dim,
                flexGrow: 1,
                // without minWidth:0 + overflow the text does not shrink in flex and spills
                // over paddingRight to the very edge of the sidebar
                minWidth: 0,
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                paddingRight: 4,
              }}
            >
              {s.title}
            </text>
          </div>
        ))}
        {sessions.length === 0 && (
          <text style={{ fontSize: fs.sm, color: t.faint, padding: sp[2] }}>Нет сессий</text>
        )}
      </div>

      {navItem({ id: "settings", label: "Настройки", icon: "settings" }, true)}

      {/* resize handle: pointer capture on the node itself */}
      <div
        onMouseDown={drag.onMouseDown}
        onMouseMove={drag.onMouseMove}
        onMouseUp={drag.onMouseUp}
        style={{
          position: "absolute",
          top: 0,
          right: -3,
          bottom: 0,
          width: 6,
          cursor: "col-resize",
          backgroundColor: "transparent",
        }}
      />
    </div>
  );
}
