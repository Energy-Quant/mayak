/**
 * AppsPage — Приложения: HTML-приложения goose из ~/.local/share/goose/apps.
 * Порт с Tauri/CSS на GPUIX: getStoredApps → api/db.listStoredApps,
 * openApp → api/config.openApp (синхронно, try/catch → строка под карточкой).
 */
import { useEffect, useState } from "react";
import { listStoredApps } from "../api/db";
import { openApp } from "../api/config";
import { Icon } from "./Icon";
import { fs, type WaveTheme } from "../tokens";
import { log } from "../logger";

export function AppsPage(props: { t: WaveTheme }) {
  const t = props.t;
  const [apps, setApps] = useState<string[]>([]);
  const [err, setErr] = useState(""); // ошибка загрузки списка → banner сверху
  const [openErr, setOpenErr] = useState<{ name: string; msg: string } | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    try {
      setApps([...listStoredApps()].sort((a, b) => a.localeCompare(b, "ru")));
    } catch (e) {
      setErr(String(e).slice(0, 120));
    }
  }, []);

  const launch = (name: string) => {
    setBusy(name);
    setOpenErr(null);
    try {
      openApp(name);
    } catch (e) {
      setOpenErr({ name, msg: String(e).slice(0, 120) });
    }
    setBusy("");
  };

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        flexDirection: "column",
        padding: 24,
        overflowY: "scroll",
        backgroundColor: t.bg,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="app" size={18} color={t.magenta} />
        <text style={{ fontSize: fs.xl, color: t.text, fontWeight: 650, whiteSpace: "nowrap" }}>
          Приложения
        </text>
      </div>
      <text style={{ fontSize: fs.md, color: t.dim, marginTop: 6, marginBottom: 4 }}>
        HTML-приложения из хранилища goose (~/.local/share/goose/apps). Кнопка «Открыть»
        запускает файл в системном браузере.
      </text>

      {err ? (
        <div
          style={{
            display: "flex",
            backgroundColor: t.error + "1f",
            borderWidth: 1,
            borderColor: t.error,
            borderRadius: 13,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 10,
            paddingBottom: 10,
            marginTop: 8,
            marginBottom: 4,
          }}
        >
          <text style={{ fontSize: fs.sm, color: t.text }}>{`⚠ ${err}`}</text>
        </div>
      ) : null}

      {apps.length === 0 && !err ? (
        <text style={{ fontSize: fs.md, color: t.dim, marginTop: 12 }}>
          Приложений нет — они появятся, когда goose создаст их в чате.
        </text>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
          {apps.map((a) => (
            <div
              key={a}
              style={{ display: "flex", flexDirection: "column", marginBottom: 10 }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  backgroundColor: t.surface,
                  borderWidth: 1,
                  borderColor: t.border,
                  borderRadius: 13,
                  paddingLeft: 12,
                  paddingRight: 12,
                  paddingTop: 12,
                  paddingBottom: 12,
                  hover: { backgroundColor: t.glass },
                }}
              >
                <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                  <text
                    style={{
                      fontSize: fs.base,
                      color: t.text,
                      fontWeight: 650,
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {`${a}`}
                  </text>
                </div>
                <div
                  onClick={() => launch(a)}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingLeft: 14,
                    paddingRight: 14,
                    paddingTop: 7,
                    paddingBottom: 7,
                    borderRadius: 99,
                    borderWidth: 1,
                    borderColor: t.magenta,
                    backgroundColor: t.magenta,
                    cursor: busy === a ? "default" : "pointer",
                    opacity: busy === a ? 0.6 : 1,
                    hover: { backgroundColor: t.violet },
                  }}
                >
                  <text
                    style={{
                      fontSize: fs.sm,
                      color: t.userBubbleText,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {busy === a ? "…" : "Открыть"}
                  </text>
                </div>
              </div>
              <text style={{ fontSize: fs.xs, color: t.faint, marginTop: 4, whiteSpace: "nowrap" }}>
                {`~/.local/share/goose/apps/${a}.html`}
              </text>
              {openErr && openErr.name === a ? (
                <text style={{ fontSize: fs.xs, color: t.error, marginTop: 4 }}>
                  {`⚠ ${openErr.msg}`}
                </text>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AppsPage;
