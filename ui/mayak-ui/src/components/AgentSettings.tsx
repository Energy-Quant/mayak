/**
 * AgentSettings — role fallback chains (goose/oracle/librarian) from pantheon.toml.
 * Port of AgentSettings.tsx (138 lines, Tauri/CSS) → GPUIX 0.10.
 * Legacy getChains/saveChain/getCatalog → getAgentChains/saveAgentChain (api/config),
 * getProviderCatalog (api/catalog). <select> → custom dropdown divs.
 */
import { useEffect, useState } from "react";
import {
  ROLES,
  getAgentChains,
  saveAgentChain,
  type AgentChainJson,
  type ChainStep,
  type Role,
} from "../api/config";
import { getProviderCatalog, type Catalog } from "../api/catalog";
import { fs, type WaveTheme } from "../tokens";
import { log } from "../logger";

const ROLE_LABEL: Record<Role, string> = {
  goose: "🪿 Goose — оркестратор",
  oracle: "🔥 Оракул — мыслитель",
  librarian: "📚 Библиотекарь — исследователь",
};

function roleColor(role: Role, t: WaveTheme): string {
  if (role === "oracle") return t.magenta;
  if (role === "librarian") return t.violet;
  return t.cyan;
}

/* Fallback provider list — from legacy, used until the catalog loads */
const FALLBACK_PROVIDERS = ["opencode_go", "custom_routerai", "ollama_cloud"];
const DEFAULT_STEP: ChainStep = { provider: "opencode_go", model: "glm-5.3-flash" };

function defaultChains(): AgentChainJson[] {
  return ROLES.map((role) => ({
    role,
    primary: { provider: DEFAULT_STEP.provider, model: DEFAULT_STEP.model },
    fallbacks: [],
  }));
}

/* ── icon button ── */

function MiniBtn(props: { t: WaveTheme; label: string; onClick: () => void }) {
  const t = props.t;
  return (
    <div
      onClick={props.onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.glass,
        cursor: "pointer",
        hover: { backgroundColor: t.glassHi },
      }}
    >
      <text style={{ fontSize: fs.sm, color: t.dim, whiteSpace: "nowrap" }}>{props.label}</text>
    </div>
  );
}

/* ── custom dropdown (legacy <select>) ── */

function Dropdown(props: {
  t: WaveTheme;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  width?: number;
}) {
  const t = props.t;
  const [open, setOpen] = useState(false);
  const opts =
    props.value && !props.options.includes(props.value)
      ? [props.value, ...props.options]
      : props.options;

  return (
    <div
      onMouseDownOutside={() => setOpen(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        width: props.width ?? 168,
        flexShrink: 1,
        minWidth: 0,
      }}
    >
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingTop: 7,
          paddingBottom: 7,
          paddingLeft: 10,
          paddingRight: 10,
          borderRadius: 9,
          borderWidth: 1,
          borderColor: open ? t.borderStrong : t.border,
          backgroundColor: t.glass,
          cursor: "pointer",
          hover: { backgroundColor: t.glassHi },
        }}
      >
        <text
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: fs.sm,
            color: t.text,
            flexGrow: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {props.value || "—"}
        </text>
        <text
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: fs.xs,
            color: t.dim,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {open ? "▴" : "▾"}
        </text>
      </div>

      {open ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxHeight: 240,
            overflowY: "auto",
            marginTop: 2,
            borderRadius: 9,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.raised,
          }}
        >
          {opts.map((o) => (
            <div
              key={o}
              onClick={() => {
                props.onChange(o);
                setOpen(false);
              }}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                paddingTop: 7,
                paddingBottom: 7,
                paddingLeft: 10,
                paddingRight: 10,
                backgroundColor: o === props.value ? t.navActive : "transparent",
                cursor: "pointer",
                hover: { backgroundColor: t.glassHi },
              }}
            >
              <text
                style={{
                  display: "flex",
                  flexDirection: "column",
                  fontSize: fs.sm,
                  color: t.text,
                  flexGrow: 1,
                  minWidth: 0,
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
              >
                {o}
              </text>
            </div>
          ))}
          {!opts.length ? (
            <text style={{ fontSize: fs.sm, color: t.faint, padding: 8 }}>Нет вариантов</text>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── chain step: provider → model ── */

function StepEditor(props: {
  t: WaveTheme;
  step: ChainStep;
  catalog: Catalog | null;
  index: number;
  onChange: (s: ChainStep) => void;
  onRemove?: () => void;
  onUp?: () => void;
}) {
  const t = props.t;
  const { step, catalog, index } = props;
  const providers = catalog?.providers ?? FALLBACK_PROVIDERS;
  const models =
    catalog?.models_by_provider[step.provider]?.map((m) => m.name) ?? [step.model];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginTop: 6,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          borderRadius: 9,
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.glass,
          flexShrink: 0,
        }}
      >
        <text style={{ fontSize: fs.xs, color: t.dim, whiteSpace: "nowrap" }}>
          {index === 0 ? "P" : `F${index}`}
        </text>
      </div>
      <text style={{ fontSize: fs.sm, color: t.faint, whiteSpace: "nowrap" }}>→</text>

      <Dropdown t={t} value={step.provider} options={providers} onChange={(v) => props.onChange({ ...step, provider: v })} />
      <Dropdown t={t} value={step.model} options={models} onChange={(v) => props.onChange({ ...step, model: v })} />

      {props.onUp ? <MiniBtn t={t} label="↑" onClick={props.onUp} /> : null}
      {props.onRemove ? <MiniBtn t={t} label="✕" onClick={props.onRemove} /> : null}
    </div>
  );
}

/* ── page ── */

export function AgentSettings(props: { t: WaveTheme }) {
  const t = props.t;
  const [chains, setChains] = useState<AgentChainJson[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    try {
      setChains(getAgentChains());
      setErr("");
    } catch (e) {
      // no pantheon.toml yet — start with empty chains; saving creates the file
      log.debug("ui.chains.load", String(e));
      setChains(defaultChains());
      setErr(`pantheon.toml не найден: ${String(e).slice(0, 80)}`);
    }
    getProviderCatalog()
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch((e) => {
        log.debug("ui.catalog", String(e));
        if (alive) setCatalog(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const update = (role: Role, next: AgentChainJson) => {
    setChains((cs) => cs.map((c) => (c.role === role ? next : c)));
    setDirty(true);
    setMsg("");
  };

  const saveAll = () => {
    try {
      for (const c of chains) {
        saveAgentChain(c.role, { primary: c.primary, fallbacks: c.fallbacks });
      }
      setDirty(false);
      setErr("");
      setMsg("Сохранено в pantheon.toml");
    } catch (e) {
      setErr(`Ошибка сохранения: ${String(e).slice(0, 100)}`);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 3 }}>
          <text style={{ fontSize: fs.lg, color: t.text, fontWeight: 650, whiteSpace: "nowrap" }}>
            Настройки моделей — fallback-цепочки
          </text>
          <text style={{ fontSize: fs.sm, color: t.dim }}>
            Приоритет сверху вниз: primary → fallback. Сохранение — в pantheon.toml
          </text>
        </div>
        <div
          onClick={dirty ? saveAll : undefined}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: 8,
            paddingBottom: 8,
            paddingLeft: 16,
            paddingRight: 16,
            borderRadius: 13,
            borderWidth: 1,
            borderColor: dirty ? t.borderStrong : t.border,
            backgroundColor: dirty ? t.magenta : t.glass,
            opacity: dirty ? 1 : 0.6,
            cursor: dirty ? "pointer" : "default",
            hover: { backgroundColor: dirty ? t.magenta : t.glassHi },
          }}
        >
          <text style={{ fontSize: fs.md, color: dirty ? "#1a1330" : t.dim, whiteSpace: "nowrap" }}>
            {dirty ? "Сохранить в pantheon.toml" : msg || "Сохранено"}
          </text>
        </div>
      </div>

      {err ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            backgroundColor: t.error + "1f",
            borderWidth: 1,
            borderColor: t.error,
            borderRadius: 13,
            padding: 10,
            marginTop: 10,
          }}
        >
          <text style={{ fontSize: fs.sm, color: t.text }}>{`⚠ ${err}`}</text>
        </div>
      ) : null}

      {!chains.length ? (
        <text style={{ fontSize: fs.md, color: t.dim, marginTop: 16 }}>Загрузка…</text>
      ) : (
        chains.map((chain) => (
          <div
            key={chain.role}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: 16,
              marginTop: 14,
              borderRadius: 17,
              borderWidth: 1,
              borderColor: roleColor(chain.role, t),
              backgroundColor: t.glass,
            }}
          >
            <text
              style={{
                display: "flex",
                flexDirection: "column",
                fontSize: fs.base,
                color: roleColor(chain.role, t),
                fontWeight: 650,
                whiteSpace: "nowrap",
              }}
            >
              {ROLE_LABEL[chain.role]}
            </text>

            <StepEditor
              t={t}
              step={chain.primary}
              catalog={catalog}
              index={0}
              onChange={(s) => update(chain.role, { ...chain, primary: s })}
            />

            {chain.fallbacks.map((f, i) => (
              <StepEditor
                key={`${chain.role}-f${i}`}
                t={t}
                step={f}
                catalog={catalog}
                index={i + 1}
                onChange={(s) => {
                  const fb = [...chain.fallbacks];
                  fb[i] = s;
                  update(chain.role, { ...chain, fallbacks: fb });
                }}
                onUp={() => {
                  const fb = [...chain.fallbacks];
                  if (i === 0) {
                    update(chain.role, {
                      ...chain,
                      primary: fb[0],
                      fallbacks: [chain.primary, ...fb.slice(1)],
                    });
                  } else {
                    [fb[i - 1], fb[i]] = [fb[i], fb[i - 1]];
                    update(chain.role, { ...chain, fallbacks: fb });
                  }
                }}
                onRemove={() =>
                  update(chain.role, {
                    ...chain,
                    fallbacks: chain.fallbacks.filter((_, j) => j !== i),
                  })
                }
              />
            ))}

            <div
              onClick={() =>
                update(chain.role, {
                  ...chain,
                  fallbacks: [...chain.fallbacks, { provider: "opencode_go", model: "glm-5.3-flash" }],
                })
              }
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                alignSelf: "flex-start",
                gap: 6,
                paddingTop: 7,
                paddingBottom: 7,
                paddingLeft: 14,
                paddingRight: 14,
                marginTop: 8,
                borderRadius: 13,
                borderWidth: 1,
                borderColor: t.border,
                backgroundColor: t.glass,
                cursor: "pointer",
                hover: { backgroundColor: t.glassHi },
              }}
            >
              <text style={{ fontSize: fs.sm, color: t.dim, whiteSpace: "nowrap" }}>
                + ступень fallback
              </text>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
