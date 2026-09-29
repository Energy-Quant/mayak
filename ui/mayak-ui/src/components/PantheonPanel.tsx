/**
 * PantheonPanel — панель «Маяк»: runs/артефакты/роли из pantheon.db.
 * Порт PantheonPanel.tsx: <style>+className → style-объекты, таблицы → row-сетки,
 * safeInvoke → api/db.getPantheonOverview (синхронно), clipboard → wl-copy.
 */
import { useEffect, useState } from "react";
import {
  getPantheonOverview,
  type PantheonOverview,
  type PantheonRun,
  type PantheonArtifact,
  type RoleStat,
} from "../api/db";
import { copyText } from "../api/clipboard";
import { fs, type WaveTheme } from "../tokens";
import { log } from "../logger";

const ROLE_EMOJI: Record<string, string> = {
  goose: "🪿",
  oracle: "🔥",
  librarian: "📚",
};

function roleColor(role: string, t: WaveTheme): string {
  if (role === "oracle") return t.magenta;
  if (role === "librarian") return t.violet;
  if (role === "goose") return t.cyan;
  return t.text;
}

function kindColor(kind: string, t: WaveTheme): string {
  if (kind === "plan") return t.gold;
  if (kind === "digest") return t.cyan;
  if (kind === "analysis") return t.violet;
  return t.text;
}

export default function PantheonPanel(props: { t: WaveTheme }) {
  const t = props.t;
  const [data, setData] = useState<PantheonOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      setData(getPantheonOverview());
      setError("");
    } catch (e) {
      setError(String(e).slice(0, 160));
    }
  }, []);

  const sectionTitle = (label: string) => (
    <text
      style={{
        fontSize: fs.xs,
        color: t.dim,
        fontWeight: 650,
        marginTop: 20,
        marginBottom: 8,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </text>
  );

  const empty = (msg: string) => (
    <text style={{ fontSize: fs.md, color: t.dim }}>{msg}</text>
  );

  const headCell = (label: string, width: number) => (
    <text
      style={{
        fontSize: fs.xs,
        color: t.dim,
        fontWeight: 550,
        width,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </text>
  );

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
      <text style={{ fontSize: fs.xl, color: t.text, fontWeight: 650 }}>Панель Маяка</text>
      <text style={{ fontSize: fs.md, color: t.dim, marginBottom: 8 }}>
        Мультиагентность: runs, артефакты и роли из pantheon.db
      </text>

      {error ? (
        <div
          style={{
            display: "flex",
            backgroundColor: t.error + "1f",
            borderWidth: 1,
            borderColor: t.error,
            borderRadius: 13,
            padding: 10,
            marginTop: 8,
          }}
        >
          <text style={{ fontSize: fs.sm, color: t.text, whiteSpace: "nowrap" }}>{`⚠ ${error}`}</text>
        </div>
      ) : null}

      {!data ? (
        <text style={{ fontSize: fs.md, color: t.dim, marginTop: 12 }}>Загрузка…</text>
      ) : (
        <>
          {/* ── Runs ── */}
          {sectionTitle(`RUNS (${data.runs.length})`)}
          {data.runs.length === 0
            ? empty("Пока нет запусков.")
            : (() => {
                const cols = [110, 90, 150, 130, 110]; // role/status/model/started/session
                return (
                  <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: 8,
                        paddingBottom: 6,
                        borderBottomWidth: 1,
                        borderColor: t.border,
                      }}
                    >
                      {headCell("role", cols[0])}
                      {headCell("status", cols[1])}
                      {headCell("model", cols[2])}
                      {headCell("started", cols[3])}
                      {headCell("session", cols[4])}
                    </div>
                    {data.runs.map((r: PantheonRun) => (
                      <div
                        key={r.session_id}
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          gap: 8,
                          paddingTop: 6,
                          paddingBottom: 6,
                          borderBottomWidth: 1,
                          borderColor: t.border,
                        }}
                      >
                        <text
                          style={{
                            fontSize: fs.md,
                            width: cols[0],
                            whiteSpace: "nowrap",
                            color: roleColor(r.role, t),
                          }}
                        >
                          {`${ROLE_EMOJI[r.role] ?? "•"} ${r.role}`}
                        </text>
                        <text style={{ fontSize: fs.md, width: cols[1], color: t.text, whiteSpace: "nowrap" }}>
                          {r.status}
                        </text>
                        <text
                          style={{ fontSize: fs.md, width: cols[2], color: t.dim, whiteSpace: "nowrap", textOverflow: "ellipsis" }}
                        >
                          {r.model ?? "—"}
                        </text>
                        <text style={{ fontSize: fs.md, width: cols[3], color: t.dim, whiteSpace: "nowrap" }}>
                          {r.started_at}
                        </text>
                        <text style={{ fontSize: fs.md, width: cols[4], color: t.dim, whiteSpace: "nowrap" }}>
                          {`${r.session_id.slice(0, 12)}…`}
                        </text>
                      </div>
                    ))}
                  </div>
                );
              })()}

          {/* ── Роли ── */}
          {sectionTitle("РАСХОДЫ PER-ROLE")}
          {data.role_stats.length === 0
            ? empty("Нет данных по ролям.")
            : (() => {
                const cols = [120, 70, 90, 260];
                return (
                  <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: 8,
                        paddingBottom: 6,
                        borderBottomWidth: 1,
                        borderColor: t.border,
                      }}
                    >
                      {headCell("role", cols[0])}
                      {headCell("runs", cols[1])}
                      {headCell("tokens", cols[2])}
                      {headCell("models", cols[3])}
                    </div>
                    {data.role_stats.map((s: RoleStat) => (
                      <div
                        key={s.role}
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          gap: 8,
                          paddingTop: 6,
                          paddingBottom: 6,
                          borderBottomWidth: 1,
                          borderColor: t.border,
                        }}
                      >
                        <text
                          style={{
                            fontSize: fs.md,
                            width: cols[0],
                            whiteSpace: "nowrap",
                            color: roleColor(s.role, t),
                          }}
                        >
                          {`${ROLE_EMOJI[s.role] ?? "•"} ${s.role}`}
                        </text>
                        <text style={{ fontSize: fs.md, width: cols[1], color: t.text, whiteSpace: "nowrap" }}>
                          {String(s.runs)}
                        </text>
                        <text style={{ fontSize: fs.md, width: cols[2], color: t.dim, whiteSpace: "nowrap" }}>
                          {s.tokens != null ? s.tokens.toLocaleString("ru-RU") : "—"}
                        </text>
                        <text
                          style={{
                            fontSize: fs.md,
                            width: cols[3],
                            color: t.dim,
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {s.models.length ? s.models.join(", ") : "—"}
                        </text>
                      </div>
                    ))}
                  </div>
                );
              })()}

          {/* ── Артефакты ── */}
          {sectionTitle("АРТЕФАКТЫ")}
          {(() => {
            const map = new Map<string, PantheonArtifact[]>();
            for (const a of data.artifacts) {
              const arr = map.get(a.kind) ?? [];
              arr.push(a);
              map.set(a.kind, arr);
            }
            const byKind = [...map.entries()].sort((a, b) => b[1].length - a[1].length);
            if (byKind.length === 0) {
              return empty("Артефактов ещё нет (plan / digest / analysis).");
            }
            return byKind.map(([kind, items]) => (
              <div key={kind} style={{ display: "flex", flexDirection: "column", marginBottom: 14 }}>
                <text
                  style={{
                    fontSize: fs.xs,
                    color: kindColor(kind, t),
                    fontWeight: 650,
                    marginBottom: 4,
                    whiteSpace: "nowrap",
                  }}
                >
                  {`${kind.toUpperCase()} · ${items.length}`}
                </text>
                {items.map((a, i) => (
                  <div
                    key={`${kind}-${i}`}
                    onClick={() => copyText(a.path)}
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      gap: 6,
                      paddingTop: 4,
                      paddingBottom: 4,
                      paddingLeft: 8,
                      paddingRight: 8,
                      borderRadius: 8,
                      cursor: "pointer",
                    }}
                  >
                    <text
                      style={{
                        fontSize: fs.xs,
                        color: t.text,
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        flexGrow: 1,
                        minWidth: 0,
                      }}
                    >
                      {a.path}
                    </text>
                    {a.topic ? (
                      <text style={{ fontSize: fs.xs, color: t.dim, whiteSpace: "nowrap" }}>
                        {`· ${a.topic}`}
                      </text>
                    ) : null}
                    <text style={{ fontSize: fs.xs, color: t.faint, whiteSpace: "nowrap", flexShrink: 0 }}>
                      {a.created_at}
                    </text>
                  </div>
                ))}
              </div>
            ));
          })()}
        </>
      )}
    </div>
  );
}
