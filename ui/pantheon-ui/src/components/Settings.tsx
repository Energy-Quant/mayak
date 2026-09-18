// Settings — вкладки оригинала: Модели | Пользовательский интерфейс | Чат | Внешний вид |
// Программы | Клавиатура | Авторизация | Приложение | Пантеон (наше)
import { useEffect, useState } from "react";
import { AgentSettings } from "./AgentSettings";
import { Toggle } from "./Extensions";
import { ConfigSummary, getConfigSummary, setActiveModel, setGooseMode } from "../api";
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
  ["dreamwave-night", "Тёмная (DreamWave)"],
  ["tokyonight-storm", "TokyoNight"],
  ["rosepine-moon", "Rosé Pine"],
];

const MODES = [
  ["auto", "Автономный", "Полное выполнение задач: файлы, запуски, расширения, создание и управление файлами"],
  ["approve", "Вручную", "Все действия, расширения и изменения файлов будут требовать подтверждения человеком"],
  ["chat", "Утверждать", "Минимально проверяет, какие действия требуют подтверждения, исходя из уровня риска"],
  ["chat_only", "Планировать", "Разговор с генерацией и представлением без выполнения или принятия решений"],
];

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
      {tab === "ui" && <Stub title="Пользовательский интерфейс" note="Локальные модели (HuggingFace) и Подключение к серверу" />}
      {tab === "programs" && <Stub title="Программы" note="Редактирование промптов: system.md, compaction.md, subagent_system.md, apps_create.md, apps_iterate.md, permission_judge.md, tiny_model_system.md" />}
      {tab === "keys" && <Keyboard />}
      {tab === "auth" && <Auth />}
      {tab === "app" && <Stub title="Приложение" note="Конфигурация (config.yaml), параметры трея, тема, язык" />}
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
  const [theme, setTheme] = useState<string>(() => document.documentElement.dataset.theme ?? "dreamwave-night");
  const pick = (t: string) => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem("pantheon-theme", t);
    setTheme(t);
  };
  useEffect(() => {
    const saved = localStorage.getItem("pantheon-theme");
    if (saved) { document.documentElement.dataset.theme = saved; setTheme(saved); }
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

function Stub(props: { title: string; note: string }) {
  return (
    <div className="card">
      <div className="card-title">{props.title}</div>
      <div className="dim">{props.note}</div>
      <div className="dim small" style={{ marginTop: 8 }}>Раздел реализуется в следующей итерации паритета</div>
    </div>
  );
}
