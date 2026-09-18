// AgentSettings — Экран 4: нативные fallback-селекторы per agent (требование rev 2)
import React, { useEffect, useState } from "react";
import {
  AgentChain, Catalog, ChainStep, Role, PRESETS,
  getCatalog, getChains, saveChain, validateStep,
} from "../api";

const ROLE_LABEL: Record<Role, string> = {
  goose: "🪿 Goose — оркестратор",
  oracle: "🔥 Оракул — мыслитель",
  librarian: "📚 Библиотекарь — исследователь",
};

const ROLE_VAR: Record<Role, string> = {
  goose: "var(--role-goose)",
  oracle: "var(--role-oracle)",
  librarian: "var(--role-librarian)",
};

function StepEditor(props: {
  step: ChainStep; catalog: Catalog | null; index: number;
  onChange: (s: ChainStep) => void; onRemove?: () => void; onUp?: () => void;
}) {
  const { step, catalog, index, onChange, onRemove, onUp } = props;
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const providers = catalog?.providers ?? ["opencode_go", "custom_routerai", "ollama_cloud"];
  const models = catalog?.modelsByProvider[step.provider]?.map((m) => m.name)
    ?? [step.model];

  const validate = async () => {
    setStatus(null);
    const res = await import("../api").then((m) => m.validateStep(step));
    setStatus({ ok: res.ok, text: res.ok ? `✅ ${res.latency_ms}ms` : `❌ ${res.error ?? res.status}` });
  };

  return (
    <div className="chain-step">
      <span className="idx">{index === 0 ? "P" : `F${index}`}</span>
      {index > 0 && <span className="arrow">→</span>}
      <select value={step.provider} onChange={(e) => onChange({ ...step, provider: e.target.value })}>
        {providers.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <select value={step.model} onChange={(e) => onChange({ ...step, model: e.target.value })}>
        {models.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <button onClick={validate} title="Мини-запрос к модели">Проверить</button>
      {status && <span className={`step-status ${status.ok ? "ok" : "fail"}`}>{status.text}</span>}
      {onUp && <button onClick={onUp} title="Выше по приоритету">↑</button>}
      {onRemove && <button onClick={onRemove} title="Убрать ступень">✕</button>}
    </div>
  );
}

export default function AgentSettings() {
  const [chains, setChains] = useState<AgentChain[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    getChains().then(setChains);
    getCatalog().then(setCatalog).catch(() => setCatalog(null));
  }, []);

  const update = (role: Role, next: AgentChain) => {
    setChains((cs) => cs.map((c) => (c.role === role ? next : c)));
    setDirty(true);
  };

  const applyPreset = (name: string) => {
    setChains(PRESETS[name].map((c) => ({ ...c, fallbacks: c.fallbacks.map((f) => ({ ...f })) })));
    setDirty(true);
  };

  const saveAll = async () => {
    await Promise.all(chains.map(saveChain));
    setDirty(false);
  };

  return (
    <div>
      <h2>Настройки моделей — fallback-цепочки</h2>
      <div className="preset-row">
        {Object.keys(PRESETS).map((p) => (
          <button key={p} onClick={() => applyPreset(p)}>Пресет: {p}</button>
        ))}
      </div>
      {chains.map((chain) => (
        <div key={chain.role} className="chain-card" style={{ "--role-color": ROLE_VAR[chain.role] } as React.CSSProperties}>
          <h3>{ROLE_LABEL[chain.role]}</h3>
          <StepEditor
            step={chain.primary} catalog={catalog} index={0}
            onChange={(s) => update(chain.role, { ...chain, primary: s })}
          />
          {chain.fallbacks.map((f, i) => (
            <StepEditor
              key={i} step={f} catalog={catalog} index={i + 1}
              onChange={(s) => {
                const fb = [...chain.fallbacks]; fb[i] = s;
                update(chain.role, { ...chain, fallbacks: fb });
              }}
              onUp={() => {
                const fb = [...chain.fallbacks];
                if (i === 0) {
                  update(chain.role, { primary: fb[0], fallbacks: [chain.primary, ...fb.slice(1)] });
                } else {
                  [fb[i - 1], fb[i]] = [fb[i], fb[i - 1]];
                  update(chain.role, { ...chain, fallbacks: fb });
                }
              }}
              onRemove={() => update(chain.role, {
                ...chain, fallbacks: chain.fallbacks.filter((_, j) => j !== i),
              })}
            />
          ))}
          <div className="controls">
            <button onClick={() => update(chain.role, {
              ...chain, fallbacks: [...chain.fallbacks, { provider: "opencode_go", model: "glm-5.3-flash" }],
            })}>+ ступень fallback</button>
          </div>
        </div>
      ))}
      <div className="controls" style={{ margin: 16 }}>
        <button className="primary" disabled={!dirty} onClick={saveAll}>
          {dirty ? "Сохранить в pantheon.toml" : "Сохранено"}
        </button>
      </div>
    </div>
  );
}
