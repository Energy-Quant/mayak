// Расширения — паритет оригинала (карточки + toggle из config.yaml)
import { useEffect, useState } from "react";
import { getConfigSummary, toggleExtension, ExtensionInfo } from "../api";

export function Extensions() {
  const [exts, setExts] = useState<ExtensionInfo[]>([]);
  const [error, setError] = useState("");

  const load = () =>
    getConfigSummary()
      .then((c) => setExts(c.extensions))
      .catch((e) => setError(String(e).slice(0, 120)));

  useEffect(() => { load(); }, []);

  const flip = async (name: string, enabled: boolean) => {
    // оптимистичный toggle, откат при ошибке
    setExts((xs) => xs.map((x) => (x.name === name ? { ...x, enabled } : x)));
    try {
      await toggleExtension(name, enabled);
    } catch (e) {
      setError(String(e).slice(0, 120));
      load();
    }
  };

  const bundled = exts.filter((x) => x.bundled || isDefault(x.name));
  const other = exts.filter((x) => !bundled.includes(x));

  return (
    <div className="page">
      <h1>Расширения</h1>
      <p className="page-desc">
        Это расширения, являющиеся частью Model Context Protocol (MCP); они расширяют возможности
        Goose с помощью таких свободных контекстов, как промпты, ресурсы и инструментация.
      </p>
      {error && <div className="error-banner">⚠ {error}</div>}
      <div className="row-actions">
        <button className="primary">＋ Добавить пользовательское расширение</button>
        <button>⌕ Просмотреть расширения</button>
      </div>
      <Section title={`Расширения по умолчанию (${bundled.length})`} items={bundled} onFlip={flip} />
      <Section title={`Прочие (${other.length})`} items={other} onFlip={flip} />
    </div>
  );
}

function isDefault(name: string) {
  return ["analyze", "apps", "autovisualiser", "chatrecall", "chromedevtools",
    "computercontroller", "context7", "developer", "extensionmanager", "memory",
    "skills", "summarize", "summon", "todo", "tom", "jetbrains"].includes(name);
}

function Section(props: {
  title: string; items: ExtensionInfo[];
  onFlip: (name: string, enabled: boolean) => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <>
      <h3 className="ext-section-title">{props.title}</h3>
      <div className="ext-grid">
        {props.items.map((x) => (
          <div key={x.name} className="ext-card">
            <div className="ext-head">
              <span className="ext-name">{x.name}</span>
              <Toggle checked={x.enabled} onChange={(v) => props.onFlip(x.name, v)} />
            </div>
            <div className="ext-desc">{x.description}</div>
          </div>
        ))}
      </div>
    </>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`switch${props.checked ? " on" : ""}`}
      onClick={() => props.onChange(!props.checked)}
      role="switch"
      aria-checked={props.checked}
    >
      <span className="knob" />
    </button>
  );
}
