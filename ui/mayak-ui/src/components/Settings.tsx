/**
 * Settings — 9 tabs: Models | User interface | Chat | Appearance |
 * Prompts | Keyboard | Authorization | App | State.
 * Port of Settings.tsx (480 lines, Tauri/CSS) → GPUIX 0.10 (style objects, no DOM).
 * Toggle is a local copy: we do NOT import ./Extensions (never touch that file).
 */
import { useEffect, useState, type ReactNode } from "react";
import PantheonPanel from "./PantheonPanel";
import Keyboard from "./Keyboard";
import Auth from "./Auth";
import { Icon } from "./Icon";
import {
  getConfigSummary,
  getConfigPaths,
  getConfigLimits,
  openConfigDir,
  setActiveModel,
  setGooseMode,
  listPromptFiles,
  readPromptFile,
  savePromptFile,
  type ConfigLimits,
  type ConfigPaths,
  type GooseConfigSummary,
  type PromptFileInfo,
} from "../api/config";
import { getProviderCatalog, type Catalog } from "../api/catalog";
import { copyText } from "../api/clipboard";
import { autoTheme, font, fs, type WaveTheme } from "../tokens";
import { log } from "../logger";

const TABS = [
  ["models", "Модели"],
  ["ui", "Пользовательский интерфейс"],
  ["chat", "Чат"],
  ["appearance", "Внешний вид"],
  ["programs", "Программы"],
  ["keys", "Клавиатура"],
  ["auth", "Авторизация"],
  ["app", "Приложение"],
  ["state", "Состояние"],
] as const;
type Tab = (typeof TABS)[number][0];

const THEMES: [string, string][] = [
  ["auto", "Авто · день 10–16 → светлая, иначе тёмная"],
  ["light", "День — свет и волны"],
  ["dark", "Закат — ветер и вода"],
];

/* Copied from legacy — GOOSE_MODE: id, label, description */
const MODES: [string, string, string][] = [
  ["auto", "Автономный", "Полное выполнение задач: файлы, запуски, расширения, создание и управление файлами"],
  ["approve", "Вручную", "Все действия, расширения и изменения файлов будут требовать подтверждения человеком"],
  ["smart_approve", "Утверждать", "Минимально проверяет, какие действия требуют подтверждения, исходя из уровня риска"],
  ["chat", "Чат", "Разговор, генерация и планы без выполнения: инструменты не вызываются"],
];

const THEME_KEY = "mayak-theme";

/** Current theme from localStorage: auto|light|dark (App reads the same key). */
function readThemeMode(): string {
  const v = globalThis.localStorage?.getItem(THEME_KEY);
  return v === "light" || v === "dark" ? v : "auto";
}

function themeShort(mode: string): string {
  if (mode === "auto") return autoTheme() === "light" ? "Светлая" : "Тёмная";
  return mode === "light" ? "Светлая" : "Тёмная";
}

/* ── base primitives (card, button, chip, error, toggle, radio row) ── */

function ErrBox(props: { t: WaveTheme; msg: string }) {
  if (!props.msg) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        backgroundColor: props.t.error + "1f",
        borderWidth: 1,
        borderColor: props.t.error,
        borderRadius: 13,
        padding: 10,
        marginTop: 8,
      }}
    >
      <text style={{ fontSize: fs.sm, color: props.t.text }}>{`⚠ ${props.msg}`}</text>
    </div>
  );
}

function Card(props: {
  t: WaveTheme;
  title: string;
  desc?: string;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const t = props.t;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 16,
        marginTop: 12,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.glass,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 3 }}>
          <text style={{ fontSize: fs.base, color: t.text, fontWeight: 650, whiteSpace: "nowrap" }}>
            {props.title}
          </text>
          {props.desc ? <text style={{ fontSize: fs.sm, color: t.dim }}>{props.desc}</text> : null}
        </div>
        {props.right ?? null}
      </div>
      {props.children ?? null}
    </div>
  );
}

function Btn(props: {
  t: WaveTheme;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const t = props.t;
  const on = !props.disabled;
  return (
    <div
      onClick={on ? props.onClick : undefined}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingTop: 7,
        paddingBottom: 7,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: props.primary ? t.borderStrong : t.border,
        backgroundColor: props.primary ? t.magenta : t.glass,
        opacity: on ? 1 : 0.5,
        cursor: on ? "pointer" : "default",
        hover: { backgroundColor: props.primary ? t.magenta : t.glassHi },
      }}
    >
      <text style={{ fontSize: fs.md, color: props.primary ? "#1a1330" : t.text, whiteSpace: "nowrap" }}>
        {props.label}
      </text>
    </div>
  );
}

/** Inert chip (parity with the handler-less <button> in legacy). */
function Chip(props: { t: WaveTheme; label: string }) {
  const t = props.t;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.glass,
      }}
    >
      <text style={{ fontSize: fs.sm, color: t.dim, whiteSpace: "nowrap" }}>{props.label}</text>
    </div>
  );
}

/** Local Toggle (copy of Extensions.tsx, rewritten for GPUIX). */
function Toggle(props: { t: WaveTheme; checked: boolean; onChange: (v: boolean) => void }) {
  const t = props.t;
  return (
    <div
      onClick={() => props.onChange(!props.checked)}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: props.checked ? "flex-end" : "flex-start",
        width: 42,
        height: 22,
        padding: 2,
        borderRadius: 11,
        borderWidth: 1,
        borderColor: props.checked ? t.green : t.borderStrong,
        backgroundColor: props.checked ? t.green : t.glass,
        cursor: "pointer",
        hover: { backgroundColor: props.checked ? t.green : t.glassHi },
      }}
    >
      <div
        style={{
          display: "flex",
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: props.checked ? "#14122a" : t.faint,
        }}
      />
    </div>
  );
}

/** Radio row (legacy <label><input type="radio"> → custom dot). */
function RadioRow(props: {
  t: WaveTheme;
  label: string;
  desc?: string;
  active: boolean;
  onClick: () => void;
}) {
  const t = props.t;
  return (
    <div
      onClick={props.onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginTop: 6,
        padding: 10,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: props.active ? t.borderStrong : "transparent",
        backgroundColor: props.active ? t.navActive : "transparent",
        cursor: "pointer",
        hover: { backgroundColor: t.glass },
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 2 }}>
        <text style={{ fontSize: fs.md, color: props.active ? t.text : t.dim }}>{props.label}</text>
        {props.desc ? <text style={{ fontSize: fs.xs, color: t.faint }}>{props.desc}</text> : null}
      </div>
      <div
        style={{
          display: "flex",
          width: 18,
          height: 18,
          borderRadius: 9,
          borderWidth: 1,
          borderColor: props.active ? t.magenta : t.borderStrong,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {props.active ? (
          <div
            style={{ display: "flex", width: 9, height: 9, borderRadius: 5, backgroundColor: t.magenta }}
          />
        ) : null}
      </div>
    </div>
  );
}

function ToggleCard(props: { t: WaveTheme; title: string; desc: string; on?: boolean }) {
  const t = props.t;
  const [on, setOn] = useState(props.on ?? false);
  return (
    <Card t={t} title={props.title}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
          <text style={{ fontSize: fs.sm, color: t.dim }}>{props.desc}</text>
        </div>
        <Toggle t={t} checked={on} onChange={setOn} />
      </div>
    </Card>
  );
}

/* ── page ── */

export function Settings(props: {
  t: WaveTheme;
  onThemeChange?: (mode: "light" | "dark" | "auto") => void;
}) {
  const t = props.t;
  const [tab, setTab] = useState<Tab>("models");

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
      <text style={{ fontSize: fs.xl, color: t.text, fontWeight: 650, whiteSpace: "nowrap" }}>
        Настройки
      </text>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 6,
          marginTop: 14,
          marginBottom: 6,
          overflowX: "auto",
        }}
      >
        {TABS.map(([id, label]) => (
          <div
            key={id}
            onClick={() => setTab(id)}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              paddingTop: 8,
              paddingBottom: 8,
              paddingLeft: 14,
              paddingRight: 14,
              borderRadius: 13,
              borderWidth: 1,
              borderColor: tab === id ? t.borderStrong : t.border,
              backgroundColor: tab === id ? t.navActive : "transparent",
              flexShrink: 0,
              cursor: "pointer",
              hover: { backgroundColor: t.glassHi },
            }}
          >
            <text style={{ fontSize: fs.md, color: tab === id ? t.text : t.dim, whiteSpace: "nowrap" }}>
              {label}
            </text>
          </div>
        ))}
      </div>

      {tab === "models" && <ModelsTab t={t} />}
      {tab === "ui" && <UiTab t={t} />}
      {tab === "chat" && <ChatTab t={t} />}
      {tab === "appearance" && <AppearanceTab t={t} onThemeChange={props.onThemeChange} />}
      {tab === "programs" && <ProgramsTab t={t} />}
      {tab === "keys" && <Keyboard t={t} />}
      {tab === "auth" && <Auth t={t} />}
      {tab === "app" && <AppTab t={t} onThemeChange={props.onThemeChange} />}
      {tab === "state" && <PantheonPanel t={t} />}
    </div>
  );
}

/* ── Models ── */

function ModelsTab(props: { t: WaveTheme }) {
  const t = props.t;
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  const [saved, setSaved] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    try {
      const c = getConfigSummary();
      setModel(c.goose_model);
      setProvider(c.goose_provider);
    } catch (e) {
      setErr(`Конфиг goose недоступен: ${String(e).slice(0, 80)}`);
    }
  }, []);

  const save = () => {
    try {
      setActiveModel(provider, model);
      setSaved("Сохранено в config.yaml");
      setErr("");
    } catch (e) {
      setSaved("");
      setErr(String(e).slice(0, 120));
    }
  };

  const field = (value: string, set: (v: string) => void, ph: string, w: number) => (
    <input
      value={value}
      placeholder={ph}
      onChange={(e) => set(e.value ?? "")}
      style={{
        width: w,
        fontSize: fs.md,
        color: t.text,
        backgroundColor: t.glass,
        borderWidth: 1,
        borderColor: t.border,
        borderRadius: 13,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 8,
      }}
    />
  );

  return (
    <>
      <Card t={t} title={model || "—"} desc="текущая модель">
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 }}>
          {field(provider, setProvider, "провайдер (opencode_go)", 200)}
          {field(model, setModel, "модель (glm-5.3-flash)", 240)}
          <Btn t={t} label="Применить" primary onClick={save} />
        </div>
        {saved ? <text style={{ fontSize: fs.sm, color: t.dim }}>{saved}</text> : null}
        <ErrBox t={t} msg={err} />
      </Card>

      <Card t={t} title="Особые провайдеры и модели" desc="Собирайте выбранные модели и настройки провайдеров, чтобы начать заново">
        <div
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
            marginTop: 4,
            borderRadius: 13,
            borderWidth: 1,
            borderColor: t.error,
            backgroundColor: t.error + "1f",
          }}
        >
          <text style={{ fontSize: fs.md, color: t.error, whiteSpace: "nowrap" }}>
            ♻ Сбросить провайдеров и модели
          </text>
        </div>
        <text style={{ fontSize: fs.sm, color: t.faint }}>
          Эта кнопка очистит модель и настройки провайдеров, пока вы не перенастроите их
        </text>
      </Card>
    </>
  );
}

/* ── User interface ── */

function UiTab(props: { t: WaveTheme }) {
  const t = props.t;
  const [cfg, setCfg] = useState<Omit<GooseConfigSummary, "providers"> | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    try {
      setCfg(getConfigSummary());
    } catch (e) {
      setErr(`Конфиг goose недоступен: ${String(e).slice(0, 80)}`);
    }
    getProviderCatalog()
      .then((c) => setCatalog(c))
      .catch(() => setCatalog(null));
  }, []);

  const applyMode = (m: string) => {
    try {
      setGooseMode(m);
      setCfg(getConfigSummary());
      setErr("");
    } catch (e) {
      setErr(String(e).slice(0, 100));
    }
  };

  const models = catalog ? (catalog.models_by_provider[cfg?.goose_provider ?? ""] ?? []) : [];

  return (
    <>
      <Card
        t={t}
        title="Тема"
        desc="Авто — день 10–16 светлая, иначе тёмная"
        right={<Chip t={t} label={themeShort(readThemeMode())} />}
      >
        <text style={{ fontSize: fs.sm, color: t.faint }}>
          Переключение темы — на вкладке «Внешний вид»
        </text>
      </Card>

      <Card
        t={t}
        title="Режим Goose"
        desc="Как агент взаимодействует с инструментами и расширениями (GOOSE_MODE)"
      >
        {MODES.map(([id, label, desc]) => (
          <RadioRow
            key={id}
            t={t}
            label={label}
            desc={desc}
            active={cfg?.goose_mode === id}
            onClick={() => applyMode(id)}
          />
        ))}
        <ErrBox t={t} msg={err} />
      </Card>

      <Card t={t} title="Активная модель" desc="Провайдер и модель из config.yaml">
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 2 }}>
            <text style={{ fontSize: fs.md, color: t.text }}>{cfg?.goose_model || "—"}</text>
            <text style={{ fontSize: fs.sm, color: t.dim }}>
              {cfg?.goose_provider || cfg?.active_provider || "—"}
            </text>
          </div>
          <text style={{ fontSize: fs.xs, color: t.faint, whiteSpace: "nowrap" }}>
            изменение — вкладка «Модели»
          </text>
        </div>
        <text style={{ fontSize: fs.xs, color: t.dim }}>
          {catalog
            ? `${catalog.providers.length} провайдеров · ${models.length} моделей у активного провайдера`
            : "Каталог провайдеров: загрузка…"}
        </text>
        {models.length ? (
          <text style={{ fontSize: fs.xs, color: t.faint }}>
            {models.slice(0, 6).map((m) => m.name).join(", ")}
          </text>
        ) : null}
      </Card>

      <Card t={t} title="Локальные модели (HuggingFace)" desc="Запуск моделей на своём железе">
        <text style={{ fontSize: fs.sm, color: t.faint, whiteSpace: "nowrap" }}>позже</text>
      </Card>
      <Card t={t} title="Подключение к серверу" desc="Удалённый goose-сервер вместо локального">
        <text style={{ fontSize: fs.sm, color: t.faint, whiteSpace: "nowrap" }}>позже</text>
      </Card>
    </>
  );
}

/* ── Chat ── */

function ChatTab(props: { t: WaveTheme }) {
  const t = props.t;
  const [cfg, setCfg] = useState<Omit<GooseConfigSummary, "providers"> | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    try {
      setCfg(getConfigSummary());
    } catch (e) {
      setErr(`Конфиг goose недоступен: ${String(e).slice(0, 80)}`);
    }
  }, []);

  const applyMode = (m: string) => {
    try {
      setGooseMode(m);
      setCfg(getConfigSummary());
      setErr("");
    } catch (e) {
      setErr(String(e).slice(0, 100));
    }
  };

  return (
    <>
      <Card t={t} title="Режимы" desc="Настройте, как Goose взаимодействует с инструментами и расширениями">
        {MODES.map(([id, label, desc]) => (
          <RadioRow
            key={id}
            t={t}
            label={label}
            desc={desc}
            active={cfg?.goose_mode === id}
            onClick={() => applyMode(id)}
          />
        ))}
        <ErrBox t={t} msg={err} />
      </Card>

      <Card
        t={t}
        title="Ограничения разговоров"
        right={<Icon name="chevron-down" size={16} color={t.dim} />}
      />

      <Card
        t={t}
        title="Подсказка проекта (.goosehints)"
        desc="Настройте файл подсказок вашего проекта, чтобы предоставить Goose дополнительный контекст"
        right={<Chip t={t} label="Настроить" />}
      />

      <Card
        t={t}
        title="Предпросмотр голосовой диктовки"
        desc="Включать ли проверку орфографии в поле ввода"
        right={<Chip t={t} label="Отключено" />}
      />

      <ToggleCard
        t={t}
        title="Включить проверку орфографии"
        desc="Проверка орфографии в поле ввода для повышения точности"
      />

      <StylesCard t={t} />

      <ToggleCard
        t={t}
        title="Use Legacy Agent Loop"
        desc="Fallback to the classic agent loop if the new one causes issues"
      />

      <ToggleCard
        t={t}
        title="Включить обнаружение prompt injection"
        desc="Обнаружение и предотвращение злонамеренных инъекций prompt-инструкций"
      />
    </>
  );
}

function StylesCard(props: { t: WaveTheme }) {
  const t = props.t;
  const [sel, setSel] = useState(-1);
  const items: [string, string][] = [
    ["Параграф", "Вывод будет естественным по умолчанию разговорным, чтобы максимально развернуть"],
    ["Краткий", "Вывод будет естественным по умолчанию коротким и лаконичным, по типу пояснений"],
  ];
  return (
    <Card t={t} title="Стили ответов" desc="Включите, чтобы Goose должен форматировать и оформлять ответы">
      {items.map(([label, desc], i) => (
        <div
          key={label}
          onClick={() => setSel(i)}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            marginTop: 6,
            padding: 10,
            borderRadius: 13,
            borderWidth: 1,
            borderColor: sel === i ? t.borderStrong : "transparent",
            backgroundColor: sel === i ? t.navActive : "transparent",
            cursor: "pointer",
            hover: { backgroundColor: t.glass },
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 2 }}>
            <text style={{ fontSize: fs.md, color: sel === i ? t.text : t.dim }}>{label}</text>
            <text style={{ fontSize: fs.xs, color: t.faint }}>{desc}</text>
          </div>
          <div
            style={{
              display: "flex",
              width: 18,
              height: 18,
              borderRadius: 9,
              borderWidth: 1,
              borderColor: sel === i ? t.magenta : t.borderStrong,
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {sel === i ? (
              <div
                style={{ display: "flex", width: 9, height: 9, borderRadius: 5, backgroundColor: t.magenta }}
              />
            ) : null}
          </div>
        </div>
      ))}
    </Card>
  );
}

/* ── Appearance ── */

function AppearanceTab(props: {
  t: WaveTheme;
  onThemeChange?: (mode: "light" | "dark" | "auto") => void;
}) {
  const t = props.t;
  const [theme, setTheme] = useState<string>(() => readThemeMode());

  const pick = (v: string) => {
    globalThis.localStorage?.setItem(THEME_KEY, v);
    setTheme(v);
    props.onThemeChange?.(v as "light" | "dark" | "auto");
  };

  return (
    <>
      <Card
        t={t}
        title="Тема"
        desc="Выберите тему интерфейса Маяка"
        right={<Chip t={t} label={themeShort(theme)} />}
      >
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          {THEMES.map(([id, label]) => (
            <Btn
              key={id}
              t={t}
              primary={theme === id}
              label={`${theme === id ? "✓ " : ""}${label}`}
              onClick={() => pick(id)}
            />
          ))}
        </div>
        <text style={{ fontSize: fs.sm, color: t.faint }}>
          {`${THEME_KEY} = ${theme} · сейчас ${themeShort(theme)}`}
        </text>
      </Card>

      <Card t={t} title="Язык" desc="Выберите язык интерфейса" right={<Chip t={t} label="Русский" />} />
    </>
  );
}

/* ── Prompts: goose prompts ── */

function ProgramsTab(props: { t: WaveTheme }) {
  const t = props.t;
  const [files, setFiles] = useState<PromptFileInfo[]>([]);
  const [sel, setSel] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [dirty, setDirty] = useState(false);

  const openFile = (name: string, list?: PromptFileInfo[]) => {
    try {
      const text = readPromptFile(name);
      setSel(name);
      setContent(text);
      setDirty(false);
      setErr("");
      const exists = (list ?? files).find((f) => f.name === name)?.exists ?? true;
      setStatus(exists ? "" : "Файл не создан — «Сохранить» создаст его");
    } catch (e) {
      // the filename is validated server-side (PROMPT_FILES whitelist)
      setErr(String(e).slice(0, 120));
    }
  };

  const loadList = (selectName?: string) => {
    try {
      const list = listPromptFiles();
      setFiles(list);
      setErr("");
      const name = selectName ?? list[0]?.name ?? "";
      if (name) openFile(name, list);
    } catch (e) {
      setErr(String(e).slice(0, 120));
    }
  };

  useEffect(() => {
    loadList();
  }, []);

  const save = () => {
    if (!sel) return;
    try {
      savePromptFile(sel, content);
      setDirty(false);
      setErr("");
      setStatus("Сохранено · резервная копия .bak");
      loadList(sel);
    } catch (e) {
      setErr(String(e).slice(0, 120));
    }
  };

  return (
    <Card t={t} title="Промпты goose" desc="Текстовые промпты ~/.config/goose/prompts — при сохранении прежний вариант уходит в .bak">
      <div style={{ display: "flex", flexDirection: "row", gap: 16, alignItems: "stretch", marginTop: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 240, flexShrink: 0 }}>
          {files.map((f) => (
            <div
              key={f.name}
              onClick={() => openFile(f.name)}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingTop: 7,
                paddingBottom: 7,
                paddingLeft: 12,
                paddingRight: 12,
                borderRadius: 13,
                borderWidth: 1,
                borderColor: sel === f.name ? t.borderStrong : t.border,
                backgroundColor: sel === f.name ? t.navActive : "transparent",
                cursor: "pointer",
                hover: { backgroundColor: t.glassHi },
              }}
            >
              <text
                style={{
                  display: "flex",
                  flexDirection: "column",
                  fontSize: fs.sm,
                  color: sel === f.name ? t.text : t.dim,
                  flexGrow: 1,
                  minWidth: 0,
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
              >
                {f.name}
              </text>
              {!f.exists ? (
                <text style={{ fontSize: fs.xs, color: t.faint, whiteSpace: "nowrap" }}>· нет</text>
              ) : null}
            </div>
          ))}
          {!files.length ? (
            <text style={{ fontSize: fs.sm, color: t.faint }}>Список недоступен</text>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, flexGrow: 1, minWidth: 0 }}>
          <textarea
            value={content}
            readOnly={!sel}
            onChange={(e) => {
              setContent(e.value ?? "");
              setDirty(true);
            }}
            style={{
              width: "100%",
              minHeight: 300,
              fontSize: fs.md,
              color: t.text,
              backgroundColor: t.glass,
              borderWidth: 1,
              borderColor: t.border,
              borderRadius: 13,
              paddingLeft: 12,
              paddingRight: 12,
              paddingTop: 10,
              paddingBottom: 10,
              fontFamily: font,
            }}
          />
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Btn t={t} label="Сохранить" primary disabled={!sel || !dirty} onClick={save} />
            {dirty ? (
              <text style={{ fontSize: fs.sm, color: t.gold, whiteSpace: "nowrap" }}>
                есть несохранённые изменения
              </text>
            ) : null}
          </div>
          {status ? <text style={{ fontSize: fs.sm, color: t.dim }}>{status}</text> : null}
          <ErrBox t={t} msg={err} />
        </div>
      </div>
    </Card>
  );
}

/* ── App ── */

function AppTab(props: {
  t: WaveTheme;
  onThemeChange?: (mode: "light" | "dark" | "auto") => void;
}) {
  const t = props.t;
  const [paths, setPaths] = useState<ConfigPaths | null>(null);
  const [limits, setLimits] = useState<ConfigLimits | null>(null);
  const [auto, setAuto] = useState<boolean>(() => readThemeMode() === "auto");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    try {
      setPaths(getConfigPaths());
    } catch (e) {
      setErr(`Конфиг goose недоступен: ${String(e).slice(0, 80)}`);
    }
    try {
      setLimits(getConfigLimits());
    } catch (e) { log.debug("ui.error", String(e));
      setLimits(null);
    }
  }, []);

  const toggleAuto = (v: boolean) => {
    if (v) {
      globalThis.localStorage?.setItem(THEME_KEY, "auto");
      props.onThemeChange?.("auto");
      setAuto(true);
    } else {
      const cur = autoTheme();
      globalThis.localStorage?.setItem(THEME_KEY, cur);
      props.onThemeChange?.(cur);
      setAuto(false);
    }
    setMsg("");
  };

  const copyPath = () => {
    copyText(paths?.config_path ?? "");
    setMsg("Путь скопирован");
  };

  const openDir = () => {
    try {
      openConfigDir();
      setMsg("Папка конфигурации открыта");
      setErr("");
    } catch (e) {
      setMsg("");
      setErr(`Не удалось открыть папку: ${String(e).slice(0, 80)}`);
    }
  };

  const limitRow = (label: string, hint: string, value: string) => (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginTop: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderColor: t.border,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 2 }}>
        <text style={{ fontSize: fs.sm, color: t.text, whiteSpace: "nowrap" }}>{label}</text>
        <text style={{ fontSize: fs.xs, color: t.faint }}>{hint}</text>
      </div>
      <text style={{ fontSize: fs.md, color: t.dim, whiteSpace: "nowrap" }}>{value}</text>
    </div>
  );

  return (
    <>
      <Card t={t} title="Конфигурация goose" desc="config.yaml — провайдеры, модели, расширения">
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
          <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minWidth: 0 }}>
            <input
              value={paths?.config_path ?? "…"}
              readOnly
              style={{
                width: "100%",
                fontSize: fs.sm,
                color: t.text,
                backgroundColor: t.glass,
                borderWidth: 1,
                borderColor: t.border,
                borderRadius: 13,
                paddingLeft: 12,
                paddingRight: 12,
                paddingTop: 8,
                paddingBottom: 8,
              }}
            />
          </div>
          <Btn t={t} label="Открыть папку" onClick={openDir} />
          <Btn t={t} label="Копировать путь" onClick={copyPath} />
        </div>
        {msg ? <text style={{ fontSize: fs.sm, color: t.green }}>{msg}</text> : null}
        <ErrBox t={t} msg={err} />
        <text style={{ fontSize: fs.sm, color: t.dim }}>{`Промпты: ${paths?.prompts_dir ?? "…"}`}</text>
      </Card>

      <Card
        t={t}
        title="Автотема"
        desc="День 10–16 — светлая, иначе тёмная. Выбор хранится локально (mayak-theme)"
        right={<Toggle t={t} checked={auto} onChange={toggleAuto} />}
      />

      <Card t={t} title="Лимиты сессии" desc="Значения из config.yaml">
        {limitRow("GOOSE_MAX_TURNS", "максимум ходов агента", limits ? String(limits.goose_max_turns ?? "—") : "—")}
        {limitRow(
          "GOOSE_AUTO_COMPACT_THRESHOLD",
          "порог автосжатия контекста",
          limits ? String(limits.goose_auto_compact_threshold ?? "—") : "—",
        )}
        <text style={{ fontSize: fs.sm, color: t.faint, marginTop: 6 }}>
          Изменение лимитов из UI — позже
        </text>
      </Card>
    </>
  );
}
