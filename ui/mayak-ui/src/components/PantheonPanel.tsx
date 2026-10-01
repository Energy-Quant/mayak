/**
 * PantheonPanel — "Mayak" panel: runs/artifacts/roles from pantheon.db.
 * Port of PantheonPanel.tsx: <style>+className → style objects, tables → row grids,
 * safeInvoke → api/db.getPantheonOverview (synchronous), clipboard → wl-copy.
 */
import { useEffect, useState } from "react";
import {
  getPantheonOverview,
  getRoleUsage,
  getConfigAudit,
  type PantheonOverview,
  type PantheonRun,
  type PantheonArtifact,
  type RoleStat,
  type RoleUsage,
  type AuditEntry,
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
  const [usage, setUsage] = useState<RoleUsage[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      setData(getPantheonOverview());
      setUsage(getRoleUsage(7));
      setAudit(getConfigAudit(15));
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

          {/* ── Roles ── */}
          {sectionTitle("РОЛИ")}
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

          {/* ── Per-role spend for the week ── */}
          {sectionTitle("РАСХОДЫ · 7 ДНЕЙ")}
          {usage.length === 0
            ? empty("Нет данных об использовании (usage_ledger пуст).")
            : (() => {
                const cols = [120, 110, 110, 110]; // role/input/output/cost
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
                      {headCell("input", cols[1])}
                      {headCell("output", cols[2])}
                      {headCell("cost ≈", cols[3])}
                    </div>
                    {usage.map((u: RoleUsage) => (
                      <div
                        key={u.role}
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
                            color: roleColor(u.role, t),
                          }}
                        >
                          {`${ROLE_EMOJI[u.role] ?? "•"} ${u.role}`}
                        </text>
                        <text style={{ fontSize: fs.md, width: cols[1], color: t.text, whiteSpace: "nowrap" }}>
                          {u.input_tokens.toLocaleString("ru-RU")}
                        </text>
                        <text style={{ fontSize: fs.md, width: cols[2], color: t.text, whiteSpace: "nowrap" }}>
                          {u.output_tokens.toLocaleString("ru-RU")}
                        </text>
                        <text style={{ fontSize: fs.md, width: cols[3], color: t.gold, whiteSpace: "nowrap" }}>
                          {u.cost_usd != null ? `$${u.cost_usd.toFixed(4)}` : "—"}
                        </text>
                      </div>
                    ))}
                  </div>
                );
              })()}

          {/* ── Artifacts ── */}
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

          {/* ── Config change history ── */}
          {sectionTitle("ИСТОРИЯ ПРАВОК")}
          {audit.length === 0
            ? empty("Правок конфига пока нет.")
            : (() => {
                const cols = [130, 110, 150, 160]; // when/who/what/hash
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
                      {headCell("when", cols[0])}
                      {headCell("who", cols[1])}
                      {headCell("what", cols[2])}
                      {headCell("diff hash", cols[3])}
                    </div>
                    {audit.map((a: AuditEntry, i: number) => (
                      <div
                        key={`${a.created_at}-${a.id}-${i}`}
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
                        <text style={{ fontSize: fs.md, width: cols[0], color: t.dim, whiteSpace: "nowrap" }}>
                          {a.created_at}
                        </text>
                        <text
                          style={{
                            fontSize: fs.md,
                            width: cols[1],
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                            color: roleColor(a.actor, t),
                          }}
                        >
                          {a.actor || "—"}
                        </text>
                        <text
                          style={{
                            fontSize: fs.md,
                            width: cols[2],
                            color: t.text,
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {a.what}
                        </text>
                        <text style={{ fontSize: fs.md, width: cols[3], color: t.faint, whiteSpace: "nowrap" }}>
                          {a.old_hash
                            ? `${a.old_hash.slice(0, 6)} → ${a.new_hash.slice(0, 6)}`
                            : `new ${a.new_hash.slice(0, 6)}`}
                        </text>
                      </div>
                    ))}
                  </div>
                );
              })()}
        </>
      )}
    </div>
  );
}
