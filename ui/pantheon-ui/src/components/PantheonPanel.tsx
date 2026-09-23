// PantheonPanel.tsx — панель «Пантеон»: статистика мультиагентности из pantheon.db
// Один Rust-вызов get_pantheon_overview() → { runs, artifacts, role_stats }.
import { useEffect, useState } from "react";
import { isTauri, safeInvoke } from "../acp";

interface PantheonRun {
  session_id: string;
  role: string;
  status: string;
  model?: string | null;
  started_at: string;
  task_summary?: string | null;
}

interface PantheonArtifact {
  path: string;
  kind: string; // plan | digest | analysis
  topic?: string | null;
  created_at: string;
}

interface RoleStat {
  role: string;
  runs: number;
  tokens?: number | null;
  models: string[];
}

interface PantheonOverview {
  runs: PantheonRun[];
  artifacts: PantheonArtifact[];
  role_stats: RoleStat[];
}

const ROLE_EMOJI: Record<string, string> = {
  goose: "🪿",
  oracle: "🔥",
  librarian: "📚",
};

const ROLE_COLOR: Record<string, string> = {
  goose: "var(--role-goose, var(--accent-cyan))",
  oracle: "var(--role-oracle, var(--accent-magenta))",
  librarian: "var(--role-librarian, var(--accent-violet))",
};

const KIND_COLOR: Record<string, string> = {
  plan: "var(--accent-gold, #f6c177)",
  digest: "var(--accent-cyan, #66d9e8)",
  analysis: "var(--accent-violet, #7b68ee)",
};

const PP_STYLES = `
.pp-banner { border: 1px solid var(--border); border-radius: 12px; padding: 24px;
  background: var(--bg-surface); color: var(--text-dim); margin-top: 16px; display: flex;
  flex-direction: column; gap: 6px; }
.pp-banner-sub { font-size: 13px; opacity: .8; }
.pp-section { margin: 20px 0; }
.pp-title { font-size: 14px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--text-dim); margin: 0 0 8px; }
.pp-empty { color: var(--text-dim); font-size: 13px; }
.pp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.pp-table th { text-align: left; color: var(--text-dim); font-weight: 500;
  padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 12px; }
.pp-table td { padding: 6px 10px; border-bottom: 1px solid var(--border); color: var(--text); }
.pp-table tr:hover td { background: color-mix(in srgb, var(--accent-violet) 6%, transparent); }
.pp-dim { color: var(--text-dim); }
.pp-small { font-size: 11px; }
.pp-mono { font-family: ui-monospace, monospace; }
.pp-kind { margin-bottom: 14px; }
.pp-kind-badge { font-size: 12px; text-transform: uppercase; letter-spacing: .08em;
  margin-bottom: 4px; }
.pp-artifact-row { display: flex; align-items: baseline; gap: 4px; cursor: pointer;
  padding: 4px 8px; border-radius: 8px; font-size: 12px; }
.pp-artifact-row:hover { background: color-mix(in srgb, var(--accent-cyan) 8%, transparent); }
.pp-path { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-right { margin-left: auto; flex: none; }
`;

export default function PantheonPanel() {
  const [data, setData] = useState<PantheonOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    safeInvoke<PantheonOverview>("get_pantheon_overview")
      .then(setData)
      .catch((e) => setError(String(e).slice(0, 160)));
  }, []);

  if (!isTauri()) {
    return (
      <div className="page">
        <h1>Пантеон</h1>
        <style>{PP_STYLES}</style>
        <div className="pp-banner" role="note">
          🛰 Панель доступна в приложении (Tauri).
          <span className="pp-banner-sub">
            Данные pantheon.db читаются бэкендом — откройте pantheon-ui.
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <h1>Пантеон</h1>
        <div className="error-banner">⚠ {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <h1>Пантеон</h1>
        <p className="page-desc">Загрузка…</p>
      </div>
    );
  }

  const artifactsByKind = groupByKind(data.artifacts);

  return (
    <div className="page">
      <h1>Пантеон</h1>
      <p className="page-desc">
        Мультиагентность: runs, артефакты и роли из pantheon.db
      </p>
      <style>{PP_STYLES}</style>

      <RunsBlock runs={data.runs} />

      <RoleStatsBlock stats={data.role_stats} />

      <ArtifactsBlock
        byKind={artifactsByKind}
        onCopy={(p: string) => navigator.clipboard?.writeText(p)}
      />
    </div>
  );
}

function RunsBlock({ runs }: { runs: PantheonRun[] }) {
  return (
    <section className="pp-section">
      <h2 className="pp-title">Runs ({runs.length})</h2>
      {runs.length === 0 && <p className="pp-empty">Пока нет запусков.</p>}
      {runs.length > 0 && (
        <table className="pp-table">
          <thead>
            <tr>
              <th>role</th>
              <th>status</th>
              <th>model</th>
              <th>started_at</th>
              <th>session</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.session_id}>
                <td style={{ color: ROLE_COLOR[r.role] ?? "var(--text)" }}>
                  {ROLE_EMOJI[r.role] ?? "•"} {r.role}
                </td>
                <td>{r.status}</td>
                <td className="pp-dim">{r.model ?? "—"}</td>
                <td className="pp-dim">{r.started_at}</td>
                <td className="pp-dim pp-mono" title={r.session_id}>
                  {r.session_id.slice(0, 12)}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function RoleStatsBlock({ stats }: { stats: RoleStat[] }) {
  return (
    <section className="pp-section">
      <h2 className="pp-title">Расходы per-role</h2>
      {stats.length === 0 && <p className="pp-empty">Нет данных по ролям.</p>}
      {stats.length > 0 && (
        <table className="pp-table">
          <thead>
            <tr>
              <th>role</th>
              <th>runs</th>
              <th>tokens</th>
              <th>models</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.role}>
                <td style={{ color: ROLE_COLOR[s.role] ?? "var(--text)" }}>
                  {ROLE_EMOJI[s.role] ?? "•"} {s.role}
                </td>
                <td>{s.runs}</td>
                <td className="pp-dim">
                  {s.tokens != null ? s.tokens.toLocaleString("ru-RU") : "—"}
                  <span className="pp-dim pp-small">
                    {s.tokens == null ? " (в runs нет usage)" : ""}
                  </span>
                </td>
                <td className="pp-dim pp-mono">{s.models.length ? s.models.join(", ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function groupByKind(
  items: PantheonArtifact[],
): Array<[string, PantheonArtifact[]]> {
  const map = new Map<string, PantheonArtifact[]>();
  for (const a of items) {
    const arr = map.get(a.kind) ?? [];
    arr.push(a);
    map.set(a.kind, arr);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

function ArtifactsBlock({
  byKind,
  onCopy,
}: {
  byKind: Array<[string, PantheonArtifact[]]>;
  onCopy: (path: string) => void;
}) {
  return (
    <section className="pp-section">
      <h2 className="pp-title">Артефакты</h2>
      {byKind.length === 0 && (
        <p className="pp-empty">Артефактов ещё нет (plan / digest / analysis).</p>
      )}
      {byKind.map(([kind, items]) => (
        <div key={kind} className="pp-kind">
          <div
            className="pp-kind-badge"
            style={{ color: KIND_COLOR[kind] ?? "var(--text)" }}
          >
            {kind} · {items.length}
          </div>
          {items.map((a, i) => (
            <div
              key={`${kind}-${i}`}
              className="pp-artifact-row"
              title="Клик — скопировать path"
              onClick={() => onCopy(a.path)}
            >
              <span className="pp-mono pp-path">{a.path}</span>
              {a.topic ? <span className="pp-dim pp-small"> · {a.topic}</span> : null}
              <span className="pp-dim pp-small pp-right">{a.created_at}</span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
