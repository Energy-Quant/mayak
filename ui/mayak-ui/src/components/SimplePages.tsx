/**
 * SimplePages — История сессий + Рецепты (порт с Tauri/CSS на GPUIX).
 * Таблицы → ряды div'ов с фиксированными колонками; API синхронный (api/db, api/config).
 * History принимает onOpenSession — React-state из App, без window-событий.
 */
import { useEffect, useMemo, useState } from "react";
import { listSessions, type SessionRow } from "../api/db";
import { listRecipes, type RecipeRow } from "../api/config";
import { copyText } from "../api/clipboard";
import { Icon } from "./Icon";
import { fs, type WaveTheme } from "../tokens";

type SortKey = "title" | "session_type" | "total_tokens" | "updated_at" | "running";

/** SQLite/ISO → «23.09.2026, 14:05» */
function fmtDate(s: string): string {
  if (!s) return "—";
  const iso = s.includes("T") ? s : s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sortVal(r: SessionRow, k: SortKey): string | number {
  if (k === "total_tokens") return r.total_tokens ?? 0;
  if (k === "running") return r.running ? 1 : 0;
  if (k === "title") return r.title.toLowerCase();
  if (k === "session_type") return r.session_type.toLowerCase();
  return r.updated_at.toLowerCase();
}

function Dot(props: { t: WaveTheme; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        width: 8,
        height: 8,
        borderRadius: 99,
        flexShrink: 0,
        backgroundColor: props.color,
      }}
    />
  );
}

function PageHead(props: { t: WaveTheme; icon: "history" | "clipboard"; title: string }) {
  const t = props.t;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Icon name={props.icon} size={18} color={t.magenta} />
      <text style={{ fontSize: fs.xl, color: t.text, fontWeight: 650, whiteSpace: "nowrap" }}>
        {`${props.title}`}
      </text>
    </div>
  );
}

export function History(props: { t: WaveTheme; onOpenSession?: (id: string) => void }) {
  const t = props.t;
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);

  useEffect(() => {
    try {
      setRows(listSessions(onlyRunning));
    } catch {
      setRows([]);
    }
  }, [onlyRunning]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(k === "total_tokens" || k === "running" ? -1 : 1);
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        !needle ||
        r.title.toLowerCase().includes(needle) ||
        r.id.toLowerCase().includes(needle) ||
        r.session_type.toLowerCase().includes(needle),
    );
    return [...list].sort((a, b) => {
      if (a.running !== b.running) return a.running ? -1 : 1;
      const av = sortVal(a, sortKey);
      const bv = sortVal(b, sortKey);
      if (av < bv) return -sortDir;
      if (av > bv) return sortDir;
      return 0;
    });
  }, [rows, q, sortKey, sortDir]);

  const mark = (k: SortKey) => (sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : "");

  // id / тип / токены / статус / обновлена — фиксированные; «Сессия» забирает остаток
  const cols = [90, 110, 90, 95, 130];

  const headCell = (label: string, k: SortKey, width: number) => (
    <text
      onClick={() => toggleSort(k)}
      style={{
        fontSize: fs.xs,
        color: sortKey === k ? t.text : t.dim,
        fontWeight: 550,
        width,
        whiteSpace: "nowrap",
        cursor: "pointer",
      }}
    >
      {`${label}${mark(k)}`}
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
      <PageHead t={t} icon="history" title="История сессий" />
      <text style={{ fontSize: fs.md, color: t.dim, marginTop: 6, marginBottom: 4 }}>
        Сессии goose из sessions.db: название, тип, токены и активность.
      </text>

      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 8 }}>
        <input
          value={q}
          placeholder="Поиск по сессиям…"
          autoFocus
          onChange={(e) => setQ(e.value ?? "")}
          style={{
            width: 260,
            minHeight: 34,
            fontSize: fs.md,
            color: t.text,
            backgroundColor: t.glass,
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: 9,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 6,
            paddingBottom: 6,
          }}
        />
        <div
          onClick={() => setOnlyRunning(!onlyRunning)}
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
            borderColor: onlyRunning ? t.borderStrong : t.border,
            backgroundColor: onlyRunning ? t.navActive : "transparent",
            cursor: "pointer",
            hover: { backgroundColor: t.glass },
          }}
        >
          <Dot t={t} color={onlyRunning ? t.green : t.faint} />
          <text
            style={{
              fontSize: fs.sm,
              color: onlyRunning ? t.text : t.dim,
              whiteSpace: "nowrap",
            }}
          >
            {onlyRunning ? "Активные" : "Все"}
          </text>
        </div>
        <text style={{ fontSize: fs.xs, color: t.faint, whiteSpace: "nowrap" }}>
          {`Сессий: ${filtered.length}`}
        </text>
      </div>

      {filtered.length === 0 ? (
        <text style={{ fontSize: fs.md, color: t.dim, marginTop: 12 }}>
          {onlyRunning ? "Нет активных сессий" : q ? "Ничего не найдено" : "Нет сессий"}
        </text>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
          {/* шапка */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingBottom: 6,
              borderBottomWidth: 1,
              borderColor: t.border,
            }}
          >
            <text
              style={{ fontSize: fs.xs, color: t.dim, fontWeight: 550, width: cols[0], whiteSpace: "nowrap" }}
            >
              ID
            </text>
            <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minWidth: 120 }}>
              <text
                onClick={() => toggleSort("title")}
                style={{
                  fontSize: fs.xs,
                  color: sortKey === "title" ? t.text : t.dim,
                  fontWeight: 550,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                {`Сессия${mark("title")}`}
              </text>
            </div>
            {headCell("Тип", "session_type", cols[1])}
            {headCell("Токены", "total_tokens", cols[2])}
            {headCell("Статус", "running", cols[3])}
            {headCell("Обновлена", "updated_at", cols[4])}
          </div>

          {filtered.map((s) => {
            const canOpen = s.session_type !== "sub_agent" && !!props.onOpenSession;
            return (
              <div
                key={s.id}
                onClick={() => {
                  if (canOpen) props.onOpenSession?.(s.id);
                }}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingTop: 6,
                  paddingBottom: 6,
                  borderBottomWidth: 1,
                  borderColor: t.border,
                  cursor: canOpen ? "pointer" : "default",
                  hover: canOpen ? { backgroundColor: t.glass } : undefined,
                }}
              >
                <text
                  style={{
                    fontSize: fs.xs,
                    color: t.dim,
                    width: cols[0],
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {`${s.id.length > 12 ? s.id.slice(0, 12) + "…" : s.id}`}
                </text>
                <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                  <text
                    style={{
                      fontSize: fs.md,
                      color: canOpen ? t.text : t.dim,
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {`${s.title || "Без названия"}`}
                  </text>
                </div>
                <text
                  style={{
                    fontSize: fs.md,
                    color: t.dim,
                    width: cols[1],
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {`${s.session_type || "—"}`}
                </text>
                <text style={{ fontSize: fs.md, color: t.dim, width: cols[2], whiteSpace: "nowrap" }}>
                  {`${(s.total_tokens ?? 0).toLocaleString("ru")}`}
                </text>
                {s.running ? (
                  <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, width: cols[3] }}>
                    <Dot t={t} color={t.green} />
                    <text style={{ fontSize: fs.xs, color: t.text, whiteSpace: "nowrap" }}>
                      работает
                    </text>
                  </div>
                ) : (
                  <text style={{ fontSize: fs.xs, color: t.faint, width: cols[3], whiteSpace: "nowrap" }}>
                    —
                  </text>
                )}
                <text style={{ fontSize: fs.md, color: t.dim, width: cols[4], whiteSpace: "nowrap" }}>
                  {fmtDate(s.updated_at)}
                </text>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Recipes(props: { t: WaveTheme }) {
  const t = props.t;
  const [rows, setRows] = useState<RecipeRow[]>([]);

  useEffect(() => {
    try {
      setRows(
        [...listRecipes()].sort((a, b) =>
          (a.title || a.file).localeCompare(b.title || b.file, "ru"),
        ),
      );
    } catch {
      setRows([]);
    }
  }, []);

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
      <PageHead t={t} icon="clipboard" title="Рецепты" />
      <text style={{ fontSize: fs.md, color: t.dim, marginTop: 6, marginBottom: 4 }}>
        Переиспользуемые конфигурации goose: инструкции, параметры, расширения.
      </text>

      {rows.length === 0 ? (
        <text style={{ fontSize: fs.md, color: t.dim, marginTop: 12 }}>
          Рецептов нет — добавьте .yaml в ~/.config/goose/recipes
        </text>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
          {rows.map((r) => (
            <div
              key={r.file}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                backgroundColor: t.surface,
                borderWidth: 1,
                borderColor: t.border,
                borderRadius: 13,
                paddingLeft: 12,
                paddingRight: 12,
                paddingTop: 12,
                paddingBottom: 12,
                marginBottom: 10,
                hover: { backgroundColor: t.glass },
              }}
            >
              <text
                style={{ fontSize: fs.base, color: t.text, fontWeight: 650, whiteSpace: "nowrap" }}
              >
                {`${r.title || r.file}`}
              </text>
              <text style={{ fontSize: fs.sm, color: t.dim }}>{`${r.description || "Без описания"}`}</text>
              <text
                onClick={() => copyText(r.path)}
                style={{
                  fontSize: fs.xs,
                  color: t.faint,
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  cursor: "pointer",
                }}
              >
                {`${r.file}`}
              </text>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
