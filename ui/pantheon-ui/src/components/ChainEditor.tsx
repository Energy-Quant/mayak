// ChainEditor — полноценный редактор цепочек агентов (pantheon.toml) с кнопкой «Проверить».
// Модель бэкенда (src-tauri/src/pantheon.rs): AgentChainToml { primary, fallbacks[] },
// ChainStep { provider, model }. Поле note — UI-only (serde игнорирует неизвестные поля).
// Invoke: get_agent_chains / get_provider_catalog / validate_chain_step / save_agent_chain
// (только через импорты ../api; вне Tauri — banner, без крашей).
import { useEffect, useState } from "react";
import { isTauri } from "../acp";
import {
  AgentChain,
  CatalogModel,
  Role,
  getCatalog,
  getChains,
  saveChain,
  validateStep,
} from "../api";

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

export interface ChainEditorProps {
  className?: string;
}

// Каталог: api.ts типизирует camelCase, но Rust сериализует snake_case — берём оба варианта.
interface RawCatalog {
  providers?: string[];
  modelsByProvider?: Record<string, CatalogModel[]>;
  models_by_provider?: Record<string, CatalogModel[]>;
}

// ── Константы / хелперы ───────────────────────────────────────────────────────

const CHAINS: { id: ChainId; icon: string; color: string }[] = [
  { id: "goose", icon: "🪿", color: "var(--role-goose)" },
  { id: "oracle", icon: "🔥", color: "var(--role-oracle)" },
  { id: "librarian", icon: "📚", color: "var(--role-librarian)" },
  { id: "pantheon-conductor", icon: "🎼", color: "var(--accent-gold)" },
];

const isChainId = (s: string): s is ChainId =>
  CHAINS.some((c) => c.id === s);

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

const modelsFor = (cat: RawCatalog | null, provider: string): string[] => {
  if (!cat) return [];
  const map = cat.modelsByProvider ?? cat.models_by_provider ?? {};
  return (map[provider] ?? []).map((m) => m.name);
};

const checkKey = (id: ChainId, key: string) => `${id}::${key}`;

const errText = (e: unknown): string =>
  String(e instanceof Error ? e.message : e).slice(0, 200);

// ── Компонент ────────────────────────────────────────────────────────────────

export default function ChainEditor({ className }: ChainEditorProps) {
  const inTauri = isTauri();

  const [stepsByChain, setStepsByChain] = useState<Record<ChainId, EditorStep[]>>(emptySteps);
  const [selected, setSelected] = useState<ChainId>("goose");
  const [loading, setLoading] = useState(() => isTauri());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<RawCatalog | null>(null);
  const [dirty, setDirty] = useState<Record<ChainId, boolean>>(() => ({
    goose: false,
    oracle: false,
    librarian: false,
    "pantheon-conductor": false,
  }));
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});

  // Загрузка: цепочки + каталог (вне Tauri не дёргаем invoke)
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    (async () => {
      try {
        const rows = await getChains(); // в api.ts есть fallback на пресеты при ошибке
        if (!alive) return;
        setStepsByChain(() => {
          const next = emptySteps();
          for (const c of rows) {
            if (isChainId(c.role)) next[c.role] = chainToSteps(c);
          }
          return next;
        });
      } catch (e) {
        if (alive) setLoadError(errText(e));
      }
      try {
        const cat = await getCatalog();
        if (alive) setCatalog((cat as unknown as RawCatalog) ?? null);
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
      // провайдер/модель изменились — прошлая проверка неактуальна
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
      const tmp = copy[i];
      copy[i] = copy[j];
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
      steps[steps.length - 1]?.provider ?? catalog?.providers?.[0] ?? "opencode_go";
    const model = modelsFor(catalog, provider)[0] ?? "";
    mutate(id, (prev) => [...prev, mkStep(provider, model)]);
  };

  // ── «Проверить»: validate_chain_step ──
  const validateOne = async (id: ChainId, step: EditorStep) => {
    if (!isTauri() || !step.model.trim()) return;
    const ck = checkKey(id, step.key);
    setChecks((c) => ({ ...c, [ck]: { checking: true } }));
    try {
      const res = await validateStep({ provider: step.provider, model: step.model });
      setChecks((c) => ({
        ...c,
        [ck]: {
          checking: false,
          ok: res.ok,
          text: res.ok
            ? `✓ модель валидна · ${res.latency_ms}ms`
            : `✗ ${res.error ?? `HTTP ${res.status ?? "?"}`}`,
        },
      }));
    } catch (e) {
      setChecks((c) => ({
        ...c,
        [ck]: { checking: false, ok: false, text: `✗ ${errText(e)}` },
      }));
    }
  };

  // ── «Сохранить»: save_agent_chain с полной цепочкой ──
  const steps = stepsByChain[selected];
  const stepsValid =
    steps.length > 0 && steps.every((s) => s.model.trim() && s.provider.trim());
  const canSave = inTauri && !loading && !saving && dirty[selected] && stepsValid;

  const save = async () => {
    if (!canSave) return;
    const [primary, ...fallbacks] = steps;
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload = {
        role: selected as Role,
        primary: { provider: primary.provider, model: primary.model, note: primary.note },
        fallbacks: fallbacks.map((f) => ({
          provider: f.provider,
          model: f.model,
          note: f.note,
        })),
      };
      await saveChain(payload as unknown as AgentChain);
      setDirty((d) => ({ ...d, [selected]: false }));
      setSaveMsg({ ok: true, text: "Сохранено в ~/.config/goose/pantheon.toml" });
    } catch (e) {
      setSaveMsg({ ok: false, text: `Ошибка сохранения: ${errText(e)}` });
    } finally {
      setSaving(false);
    }
  };

  // ── Рендер ──
  const meta = CHAINS.find((c) => c.id === selected) ?? CHAINS[0];

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        minHeight: 320,
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
        background: "var(--bg-surface)",
      }}
    >
      {/* Вне Tauri — banner, редактор только для просмотра */}
      {!inTauri && (
        <div
          style={{
            padding: "8px 14px",
            borderBottom: "1px solid var(--border)",
            borderLeft: "3px solid var(--accent-cyan)",
            background: "rgba(102, 217, 232, .07)",
            color: "var(--text)",
            fontSize: 12,
          }}
        >
          ⚠️ Редактор цепочек — доступно в приложении. Вне Tauri режим просмотра,
          «Проверить» и «Сохранить» отключены.
        </div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Список цепочек слева */}
        <nav
          style={{
            width: 220,
            minWidth: 220,
            borderRight: "1px solid var(--border)",
            padding: "10px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: ".12em",
              color: "var(--text-dim)",
              margin: "4px 8px 8px",
            }}
          >
            ЦЕПОЧКИ
          </div>
          {CHAINS.map((c) => (
            <button
              key={c.id}
              className={`nav-item${selected === c.id ? " active" : ""}`}
              style={{ border: "none", opacity: loading ? 0.55 : 1 }}
              disabled={loading}
              onClick={() => setSelected(c.id)}
              title={c.id}
            >
              <span style={{ width: 16, textAlign: "center" }}>{c.icon}</span>
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.id}
              </span>
              {dirty[c.id] && (
                <span
                  title="не сохранено"
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--accent-gold)",
                    flexShrink: 0,
                  }}
                />
              )}
              <span className="dim mono" style={{ fontSize: 11 }}>
                {stepsByChain[c.id].length}
              </span>
            </button>
          ))}
          {loadError && (
            <div className="error-banner" style={{ marginTop: 10 }}>
              {loadError}
            </div>
          )}
        </nav>

        {/* Редактор шагов справа */}
        <section
          style={{
            flex: 1,
            minWidth: 0,
            padding: "14px 16px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <header
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 15,
                color: meta.color,
                fontFamily: "inherit",
              }}
            >
              {meta.icon} {selected}
            </h3>
            <span className="dim small mono">
              primary {steps.length > 1 ? `+ ${steps.length - 1} fallback` : ""} →
              pantheon.toml
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button
                className="primary"
                disabled={!canSave}
                onClick={save}
                title={stepsValid ? "" : "нужен хотя бы один шаг с model"}
              >
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </header>

          {saveMsg && (
            <div
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                fontSize: 12,
                border: `1px solid ${saveMsg.ok ? "var(--accent-green)" : "var(--accent-magenta)"}`,
                background: saveMsg.ok
                  ? "rgba(158, 206, 106, .08)"
                  : "rgba(246, 1, 157, .08)",
                color: "var(--text)",
              }}
            >
              {saveMsg.ok ? "✓ " : "✗ "}
              {saveMsg.text}
            </div>
          )}

          {loading ? (
            <div className="dim" style={{ padding: "24px 0", textAlign: "center" }}>
              Загрузка цепочек…
            </div>
          ) : steps.length === 0 ? (
            <div className="empty">Цепочка пуста — добавьте primary-шаг</div>
          ) : (
            steps.map((step, i) => {
              const ck = checkKey(selected, step.key);
              const check = checks[ck];
              const models = modelsFor(catalog, step.provider);
              const providers = catalog?.providers ?? [];
              // текущее значение model может отсутствовать в каталое — добавляем в options
              const modelOptions =
                !step.model || models.includes(step.model) ? models : [step.model, ...models];
              const providerOptions =
                providers.includes(step.provider) || !step.provider
                  ? providers
                  : [step.provider, ...providers];

              return (
                <div
                  key={step.key}
                  className="chain-step"
                  style={{
                    flexWrap: "wrap",
                    alignItems: "center",
                    margin: 0,
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "8px 10px",
                    background: "var(--bg)",
                  }}
                >
                  <span
                    className="idx mono"
                    style={{ color: i === 0 ? meta.color : undefined }}
                    title={i === 0 ? "primary" : `fallback #${i}`}
                  >
                    {i === 0 ? "P" : `F${i}`}
                  </span>
                  {i > 0 && <span className="arrow">→</span>}

                  {/* провайдер */}
                  {providerOptions.length > 0 ? (
                    <select
                      value={step.provider}
                      disabled={saving}
                      onChange={(e) => updateStep(selected, step.key, { provider: e.target.value })}
                    >
                      {providerOptions.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="text-input"
                      style={{ minWidth: 130 }}
                      value={step.provider}
                      disabled={saving}
                      placeholder="provider"
                      onChange={(e) => updateStep(selected, step.key, { provider: e.target.value })}
                    />
                  )}

                  {/* model: select из каталога, иначе text input */}
                  {models.length > 0 ? (
                    <select
                      value={step.model}
                      disabled={saving}
                      onChange={(e) => updateStep(selected, step.key, { model: e.target.value })}
                    >
                      {!step.model && (
                        <option value="" disabled>
                          — модель —
                        </option>
                      )}
                      {modelOptions.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="text-input"
                      style={{ minWidth: 180 }}
                      value={step.model}
                      disabled={saving}
                      placeholder="model-id"
                      onChange={(e) => updateStep(selected, step.key, { model: e.target.value })}
                    />
                  )}

                  <span style={{ flex: 1, minWidth: 8 }} />

                  <button
                    onClick={() => validateOne(selected, step)}
                    disabled={!inTauri || !step.model.trim() || !!check?.checking}
                    title="Мини-запрос к модели (validate_chain_step)"
                  >
                    {check?.checking ? "…" : "Проверить"}
                  </button>
                  <button
                    onClick={() => moveStep(selected, step.key, -1)}
                    disabled={i === 0 || saving}
                    title="Выше по приоритету"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveStep(selected, step.key, 1)}
                    disabled={i === steps.length - 1 || saving}
                    title="Ниже по приоритету"
                  >
                    ↓
                  </button>
                  <button
                    className="danger"
                    onClick={() => removeStep(selected, step.key)}
                    disabled={saving}
                    title="Удалить шаг"
                  >
                    ✕
                  </button>

                  {/* note — заметка шага (UI-only) */}
                  <input
                    className="text-input"
                    style={{
                      flexBasis: "100%",
                      width: "100%",
                      minWidth: 0,
                      marginTop: 6,
                      fontSize: 12,
                    }}
                    value={step.note}
                    disabled={saving}
                    placeholder="note — заметка шага (только редактор, в toml не пишется)"
                    onChange={(e) => updateStep(selected, step.key, { note: e.target.value })}
                  />

                  {/* результат валидации — под шагом */}
                  {check?.checking && (
                    <span className="small dim" style={{ flexBasis: "100%", marginLeft: 28 }}>
                      проверка модели…
                    </span>
                  )}
                  {check && !check.checking && (
                    <span
                      className="small mono"
                      style={{
                        flexBasis: "100%",
                        marginLeft: 28,
                        color: check.ok ? "var(--accent-green)" : "var(--accent-magenta)",
                      }}
                    >
                      {check.text}
                    </span>
                  )}
                </div>
              );
            })
          )}

          <div className="controls" style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={() => addStep(selected)} disabled={loading || saving}>
              {steps.length === 0 ? "+ шаг (primary)" : "+ шаг (fallback)"}
            </button>
          </div>

          <div className="dim small" style={{ marginTop: "auto", paddingTop: 8 }}>
            шаг = provider + model (схема AgentChainToml); note — только для редактора
            {!loading && inTauri && catalog === null && " · каталог недоступен — model вручную"}
            {steps.length > 0 && !stepsValid && " · заполните provider и model во всех шагах"}
          </div>
        </section>
      </div>
    </div>
  );
}
