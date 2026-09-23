// Settings — вкладки оригинала: Модели | Пользовательский интерфейс | Чат | Внешний вид |
// Программы | Клавиатура | Авторизация | Приложение | Пантеон (наше)
import { useEffect, useState } from "react";
import { AgentSettings } from "./AgentSettings";
import { Toggle } from "./Extensions";
import {
  ConfigLimits, ConfigPaths, ConfigSummary, PromptFileInfo,
  getConfigLimits, getConfigPaths, getConfigSummary, listPromptFiles,
  openConfigDir, readPromptFile, savePromptFile, setActiveModel, setGooseMode,
} from "../api";
import Keyboard from "./Keyboard";
import Auth from "./Auth";
// ConfigSummary используется в ChatTab

const TABS = [
  ["models", "Модели"], ["ui", "Пользовательский интерфейс"], ["chat", "Чат"],
  ["appearance", "Внешний вид"], ["programs", "Программы"], ["keys", "Клавиатура"],
  ["auth", "Авторизация"], ["app", "Приложение"], ["pantheon", "Пантеон"],
] as const;
type Tab = (typeof TABS)[number][0];

const THEMES = [
  ["auto", "Авто · день 10–16 → светлая, иначе тёмная"],
  ["light", "День — свет и волны"],
  ["dark", "Закат — ветер и вода"],
];

const MODES = [
  ["auto", "Автономный", "Полное выполнение задач: файлы, запуски, расширения, создание и управление файлами"],
  ["approve", "Вручную", "Все действия, расширения и изменения файлов будут требовать подтверждения человеком"],
  ["chat", "Утверждать", "Минимально проверяет, какие действия требуют подтверждения, исходя из уровня риска"],
  ["chat_only", "Планировать", "Разговор с генерацией и представлением без выполнения или принятия решений"],
];

/* тема по умолчанию: авто по часу — светлая 10:00–16:00, тёмная 16:00–10:00 */
export function applyThemeMode(mode: string) {
  const h = new Date().getHours();
  const t = mode === "auto" ? (h >= 10 && h < 16 ? "light" : "dark") : mode;
  document.documentElement.dataset.theme = t;
  return t;
}

export function Settings() {
  const [tab, setTab] = useState<Tab>("models");
  return (
    <div className="page">
      <h1>Настройки</h1>
      <div className="tab-row">
        {TABS.map(([id, label]) => (
          <button key={id} className={`tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "models" && <ModelsTab />}
      {tab === "chat" && <ChatTab />}
      {tab === "appearance" && <AppearanceTab />}
      {tab === "pantheon" && <AgentSettings />}
      {tab === "ui" && <UiTab />}
      {tab === "programs" && <ProgramsTab />}
      {tab === "keys" && <Keyboard />}
      {tab === "auth" && <Auth />}
      {tab === "app" && <AppTab />}
    </div>
  );
}

function ModelsTab() {
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  const [saved, setSaved] = useState("");

  const load = () => getConfigSummary().then((c) => {
    setModel(c.goose_model); setProvider(c.goose_provider);
  }).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      await setActiveModel(provider, model);
      setSaved("Сохранено в config.yaml");
      load();
    } catch (e) { setSaved(`Ошибка: ${String(e).slice(0, 80)}`); }
  };

  return (
    <div className="card">
      <div className="card-title mono">{model || "—"}</div>
      <div className="dim">текущая модель</div>
      <div className="row-actions" style={{ marginTop: 12 }}>
        <input className="text-input" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="провайдер (opencode_go)" style={{ maxWidth: 200 }} />
        <input className="text-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="модель (glm-5.3-flash)" style={{ maxWidth: 240 }} />
        <button className="primary" onClick={save}>Применить</button>
      </div>
      {saved && <div className="dim" style={{ marginTop: 6 }}>{saved}</div>}
      <div className="card-subtitle">Особые провайдеры и модели</div>
      <div className="dim">Собирайте выбранные модели и настройки провайдеров, чтобы начать заново</div>
      <button className="danger" style={{ marginTop: 8 }}>♻ Сбросить провайдеров и модели</button>
      <div className="dim small">Эта кнопка очистит модель и настройки провайдеров, пока вы не перенастроите их</div>
    </div>
  );
}

function ChatTab() {
  const [cfg, setCfg] = useState<ConfigSummary | null>(null);
  useEffect(() => { getConfigSummary().then(setCfg).catch(() => {}); }, []);

  const applyMode = async (m: string) => {
    try { await setGooseMode(m); const c = await getConfigSummary(); setCfg(c); } catch { /* показать ошибку */ }
  };

  return (
    <>
      <div className="card">
        <div className="card-title">Режимы</div>
        <div className="dim">Настройте, как Goose взаимодействует с инструментами и расширениями</div>
        {MODES.map(([id, label, desc]) => (
          <label key={id} className={`mode-row${cfg?.goose_mode === id ? " active" : ""}`}>
            <div>
              <div>{label}</div>
              <div className="dim small">{desc}</div>
            </div>
            <input type="radio" name="goose-mode" checked={cfg?.goose_mode === id} onChange={() => applyMode(id)} />
          </label>
        ))}
      </div>
      <Card title="Ограничения разговоров" collapsible />
      <Card title="Подсказка проекта (.goosehints)" desc="Настройте файл подсказок вашего проекта, чтобы предоставить Goose дополнительный контекст" action="Настроить" />
      <Card title="Предпросмотр голосовой диктовки" desc="Включать ли проверку орфографии в поле ввода" action="Отключено" />
      <SwitchCard title="Включить проверку орфографии" desc="Проверка орфографии в поле ввода для повышения точности" on={false} />
      <Card title="Стили ответов" desc="Включите, чтобы Goose должен форматировать и оформлять ответы" sub={[
        ["Параграф", "Вывод будет естественным по умолчанию разговорным, чтобы максимально развернуть"],
        ["Краткий", "Вывод будет естественным по умолчанию коротким и лаконичным, по типу пояснений"],
      ]} />
      <SwitchCard title="Use Legacy Agent Loop" desc="Fallback to the classic agent loop if the new one causes issues" on={false} />
      <SwitchCard title="Включить обнаружение prompt injection" desc="Обнаружение и предотвращение злонамеренных инъекций prompt-инструкций" on={false} />
    </>
  );
}

function AppearanceTab() {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem("pantheon-theme") ?? "auto");
  const pick = (t: string) => {
    applyThemeMode(t);
    localStorage.setItem("pantheon-theme", t);
    setTheme(t);
  };
  useEffect(() => {
    const saved = localStorage.getItem("pantheon-theme");
    applyThemeMode(saved ?? "auto");
  }, []);
  return (
    <>
      <div className="card">
        <div className="card-title">Тема</div>
        <div className="dim">Выберите тему интерфейса pantheon-ui</div>
        <div className="row-actions" style={{ marginTop: 10 }}>
          {THEMES.map(([id, label]) => (
            <button key={id} className={theme === id ? "primary" : ""} onClick={() => pick(id)}>
              {theme === id ? "✓ " : ""}{label}
            </button>
          ))}
        </div>
      </div>
      <Card title="Язык" desc="Выберите язык интерфейса" action="Русский" />
    </>
  );
}

function Card(props: { title: string; desc?: string; action?: string; sub?: [string, string][]; collapsible?: boolean }) {
  return (
    <div className="card">
      <div className="card-row">
        <div>
          <div className="card-title">{props.title}</div>
          {props.desc && <div className="dim">{props.desc}</div>}
        </div>
        {props.action && <button>{props.action}</button>}
        {props.collapsible && <button className="dim">⌄</button>}
      </div>
      {props.sub?.map(([t, d]) => (
        <label key={t} className="mode-row">
          <div><div>{t}</div><div className="dim small">{d}</div></div>
          <input type="radio" name={`sub-${props.title}`} />
        </label>
      ))}
    </div>
  );
}

function SwitchCard(props: { title: string; desc: string; on: boolean }) {
  const [on, setOn] = useState(props.on);
  return (
    <div className="card">
      <div className="card-row">
        <div>
          <div className="card-title">{props.title}</div>
          <div className="dim small">{props.desc}</div>
        </div>
        <Toggle checked={on} onChange={setOn} />
      </div>
    </div>
  );
}

/* ── Пользовательский интерфейс ── */
function UiTab() {
  const [cfg, setCfg] = useState<ConfigSummary | null>(null);
  const [theme] = useState(() => localStorage.getItem("pantheon-theme") ?? "auto");
  const [err, setErr] = useState("");

  useEffect(() => {
    getConfigSummary().then(setCfg).catch(() => setErr("Конфиг goose недоступен"));
  }, []);

  const applyMode = async (m: string) => {
    try {
      await setGooseMode(m);
      setCfg(await getConfigSummary());
      setErr("");
    } catch (e) {
      setErr(String(e).slice(0, 100));
    }
  };

  const themeShort = theme === "auto" ? "Авто" : theme === "light" ? "Светлая" : "Тёмная";

  return (
    <>
      <div className="card">
        <div className="card-row">
          <div>
            <div className="card-title">Тема</div>
            <div className="dim small">Авто — день 10–16 светлая, иначе тёмная</div>
          </div>
          <div className="dim">{themeShort}</div>
        </div>
        <div className="dim small">Переключение темы — на вкладке «Внешний вид»</div>
      </div>

      <div className="card">
        <div className="card-title">Режим Goose</div>
        <div className="dim">Как агент взаимодействует с инструментами и расширениями (GOOSE_MODE)</div>
        {MODES.map(([id, label, desc]) => (
          <label key={id} className={`mode-row${cfg?.goose_mode === id ? " active" : ""}`}>
            <div>
              <div>{label}</div>
              <div className="dim small">{desc}</div>
            </div>
            <input
              type="radio"
              name="goose-mode-ui"
              checked={cfg?.goose_mode === id}
              onChange={() => applyMode(id)}
            />
          </label>
        ))}
        {err && <div className="dim small">{err}</div>}
      </div>

      <div className="card">
        <div className="card-title">Активная модель</div>
        <div className="dim">Провайдер и модель из config.yaml</div>
        <div className="card-row" style={{ marginTop: 10 }}>
          <div>
            <div>{cfg?.goose_model || "—"}</div>
            <div className="dim small">{cfg?.goose_provider || cfg?.active_provider || "—"}</div>
          </div>
          <div className="dim small">изменение — вкладка «Модели»</div>
        </div>
      </div>

      <div className="card">
        <div className="card-row">
          <div>
            <div className="card-title">Локальные модели (HuggingFace)</div>
            <div className="dim small">Запуск моделей на своём железе</div>
          </div>
          <div className="dim small">позже</div>
        </div>
      </div>
      <div className="card">
        <div className="card-row">
          <div>
            <div className="card-title">Подключение к серверу</div>
            <div className="dim small">Удалённый goose-сервер вместо локального</div>
          </div>
          <div className="dim small">позже</div>
        </div>
      </div>
    </>
  );
}

/* ── Программы: промпты goose ── */
function ProgramsTab() {
  const [files, setFiles] = useState<PromptFileInfo[]>([]);
  const [sel, setSel] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);

  const openFile = async (name: string, list?: PromptFileInfo[]) => {
    try {
      const text = await readPromptFile(name);
      setSel(name);
      setContent(text);
      setDirty(false);
      const exists = (list ?? files).find((f) => f.name === name)?.exists ?? true;
      setStatus(exists ? "" : "Файл не создан — «Сохранить» создаст его");
    } catch (e) {
      setStatus(String(e).slice(0, 100));
    }
  };

  const loadList = async (selectName?: string) => {
    try {
      const list = await listPromptFiles();
      setFiles(list);
      const name = selectName ?? list[0]?.name ?? "";
      if (name) await openFile(name, list);
    } catch (e) {
      setStatus(String(e).slice(0, 100));
    }
  };

  useEffect(() => { loadList(); }, []);

  const save = async () => {
    if (!sel) return;
    try {
      await savePromptFile(sel, content);
      setDirty(false);
      setStatus("Сохранено · резервная копия .bak");
      await loadList(sel);
    } catch (e) {
      setStatus(String(e).slice(0, 100));
    }
  };

  return (
    <div className="card">
      <div className="card-title">Промпты goose</div>
      <div className="dim">
        Текстовые промпты ~/.config/goose/prompts — при сохранении прежний вариант уходит в .bak
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "stretch", marginTop: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 240, flexShrink: 0 }}>
          {files.map((f) => (
            <button
              key={f.name}
              className={sel === f.name ? "primary" : ""}
              onClick={() => openFile(f.name)}
            >
              {f.name}
              {!f.exists && <span className="dim small"> · нет</span>}
            </button>
          ))}
          {!files.length && <div className="empty">Список недоступен</div>}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <textarea
            className="text-input"
            value={content}
            disabled={!sel}
            onChange={(e) => { setContent(e.target.value); setDirty(true); }}
            style={{ flex: 1, minHeight: 300, width: "100%", boxSizing: "border-box", resize: "vertical" }}
          />
          <div className="row-actions" style={{ margin: 0 }}>
            <button className="primary" onClick={save} disabled={!sel || !dirty}>
              Сохранить
            </button>
            {dirty && <span className="dim small">есть несохранённые изменения</span>}
          </div>
          {status && <div className="dim small">{status}</div>}
        </div>
      </div>
    </div>
  );
}

/* ── Приложение ── */
function AppTab() {
  const [paths, setPaths] = useState<ConfigPaths | null>(null);
  const [limits, setLimits] = useState<ConfigLimits | null>(null);
  const [autoTheme, setAutoTheme] = useState(
    () => (localStorage.getItem("pantheon-theme") ?? "auto") === "auto"
  );
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getConfigPaths().then(setPaths).catch(() => setMsg("Конфиг goose недоступен"));
    getConfigLimits().then(setLimits).catch(() => {});
  }, []);

  const toggleAuto = (v: boolean) => {
    if (v) {
      applyThemeMode("auto");
      localStorage.setItem("pantheon-theme", "auto");
      setAutoTheme(true);
    } else {
      const cur = document.documentElement.dataset.theme === "light" ? "light" : "dark";
      applyThemeMode(cur);
      localStorage.setItem("pantheon-theme", cur);
      setAutoTheme(false);
    }
    setMsg("");
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(paths?.config_path ?? "");
      setMsg("Путь скопирован");
    } catch {
      setMsg("Не удалось скопировать — выделите путь вручную");
    }
  };

  const openDir = async () => {
    try {
      await openConfigDir();
      setMsg("Папка конфигурации открыта");
    } catch (e) {
      setMsg(`Не удалось открыть папку: ${String(e).slice(0, 80)}`);
    }
  };

  return (
    <>
      <div className="card">
        <div className="card-title">Конфигурация goose</div>
        <div className="dim">config.yaml — провайдеры, модели, расширения</div>
        <div className="row-actions">
          <input
            className="text-input"
            readOnly
            value={paths?.config_path ?? "…"}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button onClick={openDir}>Открыть папку</button>
          <button onClick={copyPath}>Копировать путь</button>
        </div>
        {msg && <div className="dim small">{msg}</div>}
        <div className="dim small">Промпты: {paths?.prompts_dir ?? "…"}</div>
      </div>

      <div className="card">
        <div className="card-row">
          <div>
            <div className="card-title">Автотема</div>
            <div className="dim small">
              День 10–16 — светлая, иначе тёмная. Выбор хранится локально (pantheon-theme)
            </div>
          </div>
          <Toggle checked={autoTheme} onChange={toggleAuto} />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Лимиты сессии</div>
        <div className="dim">Значения из config.yaml</div>
        <div className="card-row" style={{ marginTop: 10 }}>
          <div>
            <div>GOOSE_MAX_TURNS</div>
            <div className="dim small">максимум ходов агента</div>
          </div>
          <div>{limits?.goose_max_turns ?? "—"}</div>
        </div>
        <div className="card-row" style={{ marginTop: 10 }}>
          <div>
            <div>GOOSE_AUTO_COMPACT_THRESHOLD</div>
            <div className="dim small">порог автосжатия контекста</div>
          </div>
          <div>{limits?.goose_auto_compact_threshold ?? "—"}</div>
        </div>
        <div className="dim small">Изменение лимитов из UI — позже</div>
      </div>
    </>
  );
}
