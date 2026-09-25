/**
 * ChainEditor — GPUIX-порт редактора цепочек агентов (pantheon.toml).
 * Легаси: pantheon-ui/src/components/ChainEditor.tsx (602 строки, CSS/классы).
 *
 * Модель: цепочка = primary + fallbacks[] (шаг = provider + model).
 * note — UI-only, в toml не пишется. Только saveAgentChain (без автосинка).
 * Каталог/валидация — ../../api/catalog (асинхронно), цепочки — api/config.
 */
import { useEffect, useState } from "react";
import {
  getAgentChains,
  saveAgentChain,
  type AgentChainJson as AgentChain,
  type Role,
} from "../api/config";
import {
  getProviderCatalog,
  validateChainStep,
  type Catalog,
  type CatalogModel,
} from "../api/catalog";
import { Icon } from "./Icon";
import { fs, type WaveTheme } from "../tokens";

// ── Типы ──────────────────────────────────────────────────────────────────────

type ChainId = "goose" | "oracle" | "librarian" | "pantheon-conductor";

interface EditorStep {
  key: string; // локальный id для React-key / lookup проверок
  provider: string;
  model: string;
  note: string;
}

interface CheckState {
  checking: boolean;
  ok?: boolean;
  text?: string;
}

// ── Пресеты (скопированы as-is из легаси pantheon-ui/src/api.ts) ──────────────

const PRESETS: Record<string, AgentChain[]> = {
  "OpenCode Go (подписка)": [
    { role: "goose", primary: { provider: "opencode_go", model: "glm-5.3-flash" },
      fallbacks: [{ provider: "opencode_go", model: "glm-5.3" }] },
    { role: "oracle", primary: { provider: "opencode_go", model: "glm-5.3" },
      fallbacks: [
        { provider: "opencode_go", model: "kimi-k3" },
        { provider: "opencode_go", model: "gpt-5.6-luna" },
      ] },
    { role: "librarian", primary: { provider: "opencode_go", model: "deepseek-v4.1-flash" },
      fallbacks: [
        { provider: "opencode_go", model: "glm-5.3-flash" },
        { provider: "ollama_cloud", model: "deepseek-v4-flash:0731" },
      ] },
  ],
  "RouterAI": [
    { role: "goose", primary: { provider: "custom_routerai", model: "z-ai/glm-5.3-flash" },
      fallbacks: [] },
    { role: "oracle", primary: { provider: "opencode_go", model: "glm-5.3" },
      fallbacks: [{ provider: "custom_routerai", model: "z-ai/glm-5.3-flash" }] },
    { role: "librarian", primary: { provider: "custom_routerai", model: "z-ai/glm-5.3-flash" },
      fallbacks: [{ provider: "ollama_cloud", model: "deepseek-v4-flash:0731" }] },
  ],
};

// ── Константы / хелперы ───────────────────────────────────────────────────────

const CHAINS: { id: ChainId; emoji: string }[] = [
  { id: "goose", emoji: "🪿" },
  { id: "oracle", emoji: "🔥" },
  { id: "librarian", emoji: "📚" },
  { id: "pantheon-conductor", emoji: "🎼" },
];

const isChainId = (s: string): s is ChainId => CHAINS.some((c) => c.id === s);

const emptySteps = (): Record<ChainId, EditorStep[]> => ({
  goose: [],
  oracle: [],
  librarian: [],
  "pantheon-conductor": [],
});

let uidSeq = 0;
const uid = () => `st-${Date.now().toString(36)}-${uidSeq++}`;

const mkStep = (provider: string, model: string, note = ""): EditorStep => ({
  key: uid(),
  provider,
  model,
  note,
});

const chainToSteps = (c: AgentChain): EditorStep[] => {
  const out: EditorStep[] = [];
  if (c.primary && c.primary.model) out.push(mkStep(c.primary.provider, c.primary.model));
  for (const f of c.fallbacks ?? []) {
    if (f && f.model) out.push(mkStep(f.provider, f.model));
  }
  return out;
};

const modelsFor = (cat: Catalog | null, provider: string): string[] =>
  !cat ? [] : (cat.models_by_provider[provider] ?? []).map((m: CatalogModel) => m.name);

const checkKey = (id: ChainId, key: string) => `${id}::${key}`;

const errText = (e: unknown): string =>
  String(e instanceof Error ? e.message : e).slice(0, 200);

// ── Выпадающий список на div'ах (заменяет <select> из легаси) ────────────────

function Pick(props: {
  t: WaveTheme;
  value: string;
  options: string[];
  placeholder: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const t = props.t;
  const disabled = props.disabled ?? false;
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{ display: "flex", flexDirection: "column", minWidth: 150 }}
      onMouseDownOutside={() => setOpen(false)}
    >
      <div
        onClick={() => {
          if (!disabled) setOpen(!open);
        }}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 6,
          paddingBottom: 6,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: open ? t.borderStrong : t.border,
          backgroundColor: t.glass,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
          hover: { backgroundColor: t.glassHi },
        }}
      >
        <text
          style={{
            fontSize: fs.sm,
            color: props.value ? t.text : t.dim,
            whiteSpace: "nowrap",
          }}
        >
          {props.value || props.placeholder}
        </text>
        <div style={{ display: "flex", flexGrow: 1 }} />
        <Icon name="chevron-down" size={12} color={t.dim} />
      </div>
      {open ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: 8,
            marginTop: 2,
            backgroundColor: t.surface,
            maxHeight: 230,
            overflowY: "scroll",
          }}
        >
          {props.options.length === 0 ? (
            <div
              style={{
                display: "flex",
                paddingLeft: 8,
                paddingRight: 8,
                paddingTop: 6,
                paddingBottom: 6,
              }}
            >
              <text style={{ fontSize: fs.xs, color: t.faint }}>нет опций</text>
            </div>
          ) : (
            props.options.map((o) => (
              <div
                key={o}
                onClick={() => {
                  props.onChange(o);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  paddingLeft: 8,
                  paddingRight: 8,
                  paddingTop: 5,
                  paddingBottom: 5,
                  cursor: "pointer",
                  hover: { backgroundColor: t.glassHi },
                }}
              >
                <text
                  style={{
                    fontSize: fs.sm,
                    color: o === props.value ? t.magenta : t.text,
                    whiteSpace: "nowrap",
                  }}
                >
                  {o}
                </text>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Компонент ─────────────────────────────────────────────────────────────────

export default function ChainEditor(props: { t: WaveTheme }) {
  const t = props.t;

  const [stepsByChain, setStepsByChain] = useState<Record<ChainId, EditorStep[]>>(emptySteps);
  const [selected, setSelected] = useState<ChainId>("goose");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [dirty, setDirty] = useState<Record<ChainId, boolean>>({
    goose: false,
    oracle: false,
    librarian: false,
    "pantheon-conductor": false,
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});

  // Загрузка: цепочки (sync, вне файла — banner + PRESETS) + каталог (async)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = getAgentChains();
        if (alive) {
          setStepsByChain(() => {
            const next = emptySteps();
            for (const c of rows) {
              if (isChainId(c.role)) next[c.role] = chainToSteps(c);
            }
            return next;
          });
        }
      } catch (e) {
        if (!alive) return;
        setLoadError(errText(e));
        // нет pantheon.toml → пресет подписки как стартовое состояние
        setStepsByChain(() => {
          const next = emptySteps();
          for (const c of PRESETS["OpenCode Go (подписка)"]) next[c.role] = chainToSteps(c);
          return next;
        });
        setDirty((d) => ({ ...d, goose: true, oracle: true, librarian: true }));
      }
      try {
        const cat = await getProviderCatalog();
        if (alive) setCatalog(cat);
      } catch {
        if (alive) setCatalog(null); // каталог недоступен → model как text input
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ── Мутации шагов ──
  const mutate = (id: ChainId, fn: (steps: EditorStep[]) => EditorStep[]) => {
    setStepsByChain((prev) => ({ ...prev, [id]: fn(prev[id]) }));
    setDirty((d) => ({ ...d, [id]: true }));
    setSaveMsg(null);
  };

  const updateStep = (id: ChainId, key: string, patch: Partial<EditorStep>) => {
    mutate(id, (steps) => steps.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    if (patch.provider !== undefined || patch.model !== undefined) {
      const ck = checkKey(id, key);
      setChecks((c) => {
        if (!(ck in c)) return c;
        const n = { ...c };
        delete n[ck];
        return n;
      });
    }
  };

  const moveStep = (id: ChainId, key: string, dir: -1 | 1) => {
    mutate(id, (steps) => {
      const i = steps.findIndex((s) => s.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= steps.length) return steps;
      const copy = [...steps];
      const tmp = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = tmp;
      return copy;
    });
  };

  const removeStep = (id: ChainId, key: string) => {
    mutate(id, (steps) => steps.filter((s) => s.key !== key));
    const ck = checkKey(id, key);
    setChecks((c) => {
      if (!(ck in c)) return c;
      const n = { ...c };
      delete n[ck];
      return n;
    });
  };

  const addStep = (id: ChainId) => {
    const steps = stepsByChain[id];
    const provider =
      steps[steps.length - 1]?.provider ?? catalog?.providers[0] ?? "opencode_go";
    const model = modelsFor(catalog, provider)[0] ?? "";
    mutate(id, (prev) => [...prev, mkStep(provider, model)]);
  };

  // ── Пресеты ──
  const applyPreset = (name: string) => {
    const rows = PRESETS[name];
    if (!rows) return;
    setStepsByChain((prev) => {
      const next = { ...prev };
      for (const c of rows) next[c.role] = chainToSteps(c);
      return next;
    });
    setDirty((d) => {
      const n = { ...d };
      for (const c of rows) n[c.role] = true;
      return n;
    });
    setLoadError(null);
    setSaveMsg({ ok: true, text: `Пресет «${name}» применён — не сохранён, нажмите «Сохранить»` });
  };

  // ── «Проверить»: validateChainStep (async) ──
  const validateOne = async (id: ChainId, step: EditorStep) => {
    if (!step.model.trim()) return;
    const ck = checkKey(id, step.key);
    setChecks((c) => ({ ...c, [ck]: { checking: true } }));
    try {
      const res = await validateChainStep({ provider: step.provider, model: step.model });
      setChecks((c) => ({
        ...c,
        [ck]: {
          checking: false,
          ok: res.ok,
          text: res.ok
            ? `✓ ok · status ${res.status} · ${res.latency_ms}ms`
            : `✗ ${res.error ?? `HTTP ${res.status ?? "?"}`} · ${res.latency_ms}ms`,
        },
      }));
    } catch (e) {
      setChecks((c) => ({
        ...c,
        [ck]: { checking: false, ok: false, text: `✗ ${errText(e)}` },
      }));
    }
  };

  // ── «Сохранить»: saveAgentChain (только pantheon.toml, без автосинка) ──
  const steps = stepsByChain[selected];
  const readOnly = selected === "pantheon-conductor";
  const stepsValid = steps.length > 0 && steps.every((s) => s.model.trim() && s.provider.trim());
  const canSave = !readOnly && !loading && !saving && dirty[selected] && stepsValid;

  const save = () => {
    if (!canSave) return;
    const role: Role = selected as Role;
    const [primary, ...fallbacks] = steps;
    setSaving(true);
    setSaveMsg(null);
    try {
      saveAgentChain(role, {
        primary: { provider: primary!.provider, model: primary!.model },
        fallbacks: fallbacks.map((f) => ({ provider: f.provider, model: f.model })),
      });
      setDirty((d) => ({ ...d, [selected]: false }));
      setSaveMsg({ ok: true, text: "Сохранено в ~/.config/goose/pantheon.toml" });
    } catch (e) {
      setSaveMsg({ ok: false, text: `Ошибка сохранения: ${errText(e)}` });
    } finally {
      setSaving(false);
    }
  };

  // ── Рендер ──
  const emoji = (CHAINS.find((c) => c.id === selected) ?? CHAINS[0]!).emoji;
  const roleColor =
    selected === "goose"
      ? t.cyan
      : selected === "oracle"
        ? t.magenta
        : selected === "librarian"
          ? t.violet
          : t.gold;

  const btn = (
    label: string,
    onClick: () => void,
    opts?: { primary?: boolean; danger?: boolean; disabled?: boolean },
    listKey?: string,
  ) => {
    const dis = opts?.disabled ?? false;
    return (
      <div
        key={listKey}
        onClick={() => {
          if (!dis) onClick();
        }}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          paddingLeft: 10,
          paddingRight: 10,
          paddingTop: 5,
          paddingBottom: 5,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: opts?.danger ? t.error : opts?.primary ? t.magenta : t.border,
          backgroundColor: opts?.primary ? t.magenta : t.glass,
          cursor: dis ? "default" : "pointer",
          opacity: dis ? 0.45 : 1,
          hover: { backgroundColor: opts?.primary ? t.magenta : t.glassHi },
        }}
      >
        <text
          style={{
            fontSize: fs.sm,
            color: opts?.primary ? "#1a1330" : opts?.danger ? t.error : t.text,
            fontWeight: opts?.primary ? 650 : 400,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </text>
      </div>
    );
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
      <text style={{ fontSize: fs.xl, color: t.text, fontWeight: 650 }}>
        Цепочки агентов
      </text>
      <text style={{ fontSize: fs.md, color: t.dim, marginBottom: 4 }}>
        primary + fallbacks → ~/.config/goose/pantheon.toml
      </text>

      {/* Ошибка загрузки (нет pantheon.toml / не читается) */}
      {loadError ? (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: t.error + "1f",
            borderWidth: 1,
            borderColor: t.error,
            borderRadius: 10,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 8,
            paddingBottom: 8,
            marginTop: 8,
            marginBottom: 4,
          }}
        >
          <text style={{ fontSize: fs.sm, color: t.text }}>{`⚠ ${loadError}`}</text>
        </div>
      ) : null}

      {/* Пресеты */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 8,
          marginBottom: 8,
        }}
      >
        <text style={{ fontSize: fs.sm, color: t.dim, whiteSpace: "nowrap" }}>
          Пресеты:
        </text>
        {Object.keys(PRESETS).map((name) => btn(name, () => applyPreset(name), undefined, name))}
      </div>

      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
        {/* Список цепочек слева */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 230,
            minWidth: 230,
            gap: 2,
            paddingRight: 12,
            borderRightWidth: 1,
            borderColor: t.border,
          }}
        >
          <text
            style={{
              fontSize: fs.xs2,
              color: t.faint,
              fontWeight: 650,
              whiteSpace: "nowrap",
              marginTop: 4,
              marginBottom: 6,
            }}
          >
            ЦЕПОЧКИ
          </text>
          {CHAINS.map((c) => {
            const active = selected === c.id;
            return (
              <div
                key={c.id}
                onClick={() => setSelected(c.id)}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingLeft: 10,
                  paddingRight: 10,
                  paddingTop: 7,
                  paddingBottom: 7,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: active ? t.borderStrong : "transparent",
                  backgroundColor: active ? t.navActive : "transparent",
                  cursor: "pointer",
                  opacity: loading ? 0.55 : 1,
                  hover: { backgroundColor: active ? t.navActive : t.glass },
                }}
              >
                <text style={{ fontSize: fs.md, whiteSpace: "nowrap" }}>{c.emoji}</text>
                <text
                  style={{
                    fontSize: fs.sm,
                    color: active ? t.text : t.dim,
                    whiteSpace: "nowrap",
                    width: 120,
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                  }}
                >
                  {c.id}
                </text>
                <div style={{ display: "flex", flexGrow: 1 }} />
                {dirty[c.id] ? (
                  <div
                    style={{
                      display: "flex",
                      width: 7,
                      height: 7,
                      borderRadius: 4,
                      backgroundColor: t.gold,
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                <text style={{ fontSize: fs.xs, color: t.faint, whiteSpace: "nowrap" }}>
                  {`${stepsByChain[c.id].length}`}
                </text>
              </div>
            );
          })}
        </div>

        {/* Редактор шагов справа */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            minWidth: 0,
            paddingLeft: 16,
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <text style={{ fontSize: fs.lg, color: roleColor, whiteSpace: "nowrap" }}>
              {`${emoji} ${selected}`}
            </text>
            <text style={{ fontSize: fs.xs, color: t.faint, whiteSpace: "nowrap" }}>
              {readOnly
                ? "read-only роль — редактирование недоступно"
                : `primary${steps.length > 1 ? ` + ${steps.length - 1} fallback` : ""} → pantheon.toml`}
            </text>
            <div style={{ display: "flex", flexGrow: 1 }} />
            {!readOnly ? btn(saving ? "Сохранение…" : "Сохранить", save, {
              primary: true,
              disabled: !canSave,
            }) : null}
          </div>

          {saveMsg ? (
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                backgroundColor: (saveMsg.ok ? t.green : t.error) + "1f",
                borderWidth: 1,
                borderColor: saveMsg.ok ? t.green : t.error,
                borderRadius: 10,
                paddingLeft: 12,
                paddingRight: 12,
                paddingTop: 8,
                paddingBottom: 8,
              }}
            >
              <text style={{ fontSize: fs.sm, color: t.text }}>
                {`${saveMsg.ok ? "✓ " : "✗ "}${saveMsg.text}`}
              </text>
            </div>
          ) : null}

          {loading ? (
            <text style={{ fontSize: fs.md, color: t.dim, marginTop: 12 }}>
              Загрузка цепочек…
            </text>
          ) : steps.length === 0 ? (
            <text style={{ fontSize: fs.md, color: t.dim, marginTop: 12 }}>
              {readOnly
                ? "pantheon-conductor: цепочка не редактируется (нет в пантеоне ролей)"
                : "Цепочка пуста — добавьте primary-шаг"}
            </text>
          ) : (
            steps.map((step, i) => {
              const ck = checkKey(selected, step.key);
              const check = checks[ck];
              const models = modelsFor(catalog, step.provider);
              const providers = catalog?.providers ?? [];
              const modelOptions =
                !step.model || models.includes(step.model) ? models : [step.model, ...models];
              const providerOptions =
                providers.includes(step.provider) || !step.provider
                  ? providers
                  : [step.provider, ...providers];

              return (
                <div
                  key={step.key}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    borderWidth: 1,
                    borderColor: t.border,
                    borderRadius: 10,
                    padding: 10,
                    backgroundColor: t.surface,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {/* бейдж P / Fn */}
                    <div
                      style={{
                        display: "flex",
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        justifyContent: "center",
                        alignItems: "center",
                        backgroundColor: t.glass,
                        flexShrink: 0,
                      }}
                    >
                      <text
                        style={{
                          fontSize: fs.xs,
                          color: i === 0 ? roleColor : t.dim,
                          fontWeight: 650,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {i === 0 ? "P" : `F${i}`}
                      </text>
                    </div>
                    {i > 0 ? (
                      <text style={{ fontSize: fs.md, color: t.faint, whiteSpace: "nowrap" }}>
                        →
                      </text>
                    ) : null}

                    {/* провайдер: pick из каталога, иначе input */}
                    {providerOptions.length > 0 ? (
                      <Pick
                        t={t}
                        value={step.provider}
                        options={providerOptions}
                        placeholder="provider"
                        disabled={saving || readOnly}
                        onChange={(v) => updateStep(selected, step.key, { provider: v })}
                      />
                    ) : (
                      <input
                        value={step.provider}
                        readOnly={saving || readOnly}
                        placeholder="provider"
                        onChange={(e) =>
                          updateStep(selected, step.key, { provider: e.value ?? "" })
                        }
                        style={{
                          width: 150,
                          fontSize: fs.sm,
                          color: t.text,
                          backgroundColor: t.glass,
                          borderWidth: 1,
                          borderColor: t.border,
                          borderRadius: 8,
                          paddingLeft: 8,
                          paddingRight: 8,
                          paddingTop: 6,
                          paddingBottom: 6,
                        }}
                      />
                    )}

                    {/* модель: pick из каталога, иначе input */}
                    {models.length > 0 ? (
                      <Pick
                        t={t}
                        value={step.model}
                        options={modelOptions}
                        placeholder="— модель —"
                        disabled={saving || readOnly}
                        onChange={(v) => updateStep(selected, step.key, { model: v })}
                      />
                    ) : (
                      <input
                        value={step.model}
                        readOnly={saving || readOnly}
                        placeholder="model-id"
                        onChange={(e) =>
                          updateStep(selected, step.key, { model: e.value ?? "" })
                        }
                        style={{
                          width: 180,
                          fontSize: fs.sm,
                          color: t.text,
                          backgroundColor: t.glass,
                          borderWidth: 1,
                          borderColor: t.border,
                          borderRadius: 8,
                          paddingLeft: 8,
                          paddingRight: 8,
                          paddingTop: 6,
                          paddingBottom: 6,
                        }}
                      />
                    )}

                    <div style={{ display: "flex", flexGrow: 1 }} />

                    {!readOnly ? (
                      btn(
                        check?.checking ? "…" : "Проверить",
                        () => void validateOne(selected, step),
                        { disabled: !step.model.trim() || !!check?.checking },
                      )
                    ) : null}
                    {!readOnly
                      ? btn("↑", () => moveStep(selected, step.key, -1), {
                          disabled: i === 0 || saving,
                        })
                      : null}
                    {!readOnly
                      ? btn("↓", () => moveStep(selected, step.key, 1), {
                          disabled: i === steps.length - 1 || saving,
                        })
                      : null}
                    {!readOnly
                      ? btn("✕", () => removeStep(selected, step.key), {
                          danger: true,
                          disabled: saving,
                        })
                      : null}
                  </div>

                  {/* note — заметка шага (UI-only) */}
                  <input
                    value={step.note}
                    readOnly={saving || readOnly}
                    placeholder="note — заметка шага (только редактор, в toml не пишется)"
                    onChange={(e) => updateStep(selected, step.key, { note: e.value ?? "" })}
                    style={{
                      width: "100%",
                      fontSize: fs.xs,
                      color: t.dim,
                      backgroundColor: t.glass,
                      borderWidth: 1,
                      borderColor: t.border,
                      borderRadius: 8,
                      paddingLeft: 8,
                      paddingRight: 8,
                      paddingTop: 5,
                      paddingBottom: 5,
                    }}
                  />

                  {/* результат валидации */}
                  {check?.checking ? (
                    <text style={{ fontSize: fs.xs, color: t.dim }}>
                      проверка модели…
                    </text>
                  ) : null}
                  {check && !check.checking ? (
                    <text
                      style={{
                        fontSize: fs.xs,
                        color: check.ok ? t.green : t.error,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {check.text ?? ""}
                    </text>
                  ) : null}
                </div>
              );
            })
          )}

          {!readOnly ? (
            <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
              <div
                onClick={() => {
                  if (!loading && !saving) addStep(selected);
                }}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingLeft: 12,
                  paddingRight: 12,
                  paddingTop: 6,
                  paddingBottom: 6,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: t.border,
                  backgroundColor: t.glass,
                  cursor: loading || saving ? "default" : "pointer",
                  opacity: loading || saving ? 0.45 : 1,
                  hover: { backgroundColor: t.glassHi },
                }}
              >
                <Icon name="plus" size={14} color={t.magenta} />
                <text style={{ fontSize: fs.sm, color: t.text, whiteSpace: "nowrap" }}>
                  {steps.length === 0 ? "шаг (primary)" : "шаг (fallback)"}
                </text>
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", flexDirection: "row", marginTop: 6 }}>
            <text style={{ fontSize: fs.xs, color: t.faint }}>
              {`шаг = provider + model (схема AgentChainToml); note — только для редактора${
                !loading && catalog === null ? " · каталог недоступен — model вручную" : ""
              }${
                steps.length > 0 && !stepsValid ? " · заполните provider и model во всех шагах" : ""
              }`}
            </text>
          </div>
        </div>
      </div>
    </div>
  );
}
