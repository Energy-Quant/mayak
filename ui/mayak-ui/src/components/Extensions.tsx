/**
 * Extensions — расширения MCP из config.yaml (порт с Tauri/CSS на GPUIX).
 * Паритет легаси Extensions.tsx: секции bundled/other, оптимистичный toggle с откатом.
 * API синхронный — прямые вызовы api/config, ошибки → banner (bg error+1f).
 * Toggle экспортируется отдельно — его импортирует Settings.
 */
import { useEffect, useState } from "react";
import {
  getConfigSummary,
  toggleExtension,
  type ExtensionEntry as ExtensionInfo,
} from "../api/config";
import { Icon, type IconName } from "./Icon";
import { dark, fs, type WaveTheme } from "../tokens";
import { log } from "../logger";

const DEFAULT_EXTS = [
  "analyze", "apps", "autovisualiser", "chatrecall", "chromedevtools",
  "computercontroller", "context7", "developer", "extensionmanager", "memory",
  "skills", "summarize", "summon", "todo", "tom", "jetbrains",
];

function isDefault(name: string): boolean {
  return DEFAULT_EXTS.includes(name);
}

/** Переключатель (легаси .switch). t опционален — без него палитра dark. */
export function Toggle(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  t?: WaveTheme;
}) {
  const t = props.t ?? dark;
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
      {props.label ? (
        <text style={{ fontSize: fs.sm, color: t.dim, whiteSpace: "nowrap" }}>
          {`${props.label}`}
        </text>
      ) : null}
      <div
        onClick={() => props.onChange(!props.checked)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          width: 38,
          height: 22,
          borderRadius: 99,
          paddingLeft: 2,
          paddingRight: 2,
          justifyContent: props.checked ? "flex-end" : "flex-start",
          backgroundColor: props.checked ? t.magenta : t.glass,
          borderWidth: 1,
          borderColor: props.checked ? t.magenta : t.border,
          cursor: "pointer",
          hover: { backgroundColor: props.checked ? t.violet : t.glassHi },
        }}
      >
        <div
          style={{
            display: "flex",
            width: 16,
            height: 16,
            borderRadius: 99,
            flexShrink: 0,
            backgroundColor: props.checked ? "#ffffff" : t.faint,
          }}
        />
      </div>
    </div>
  );
}

function Banner(props: { t: WaveTheme; msg: string }) {
  const t = props.t;
  return (
    <div
      style={{
        display: "flex",
        backgroundColor: t.error + "1f",
        borderWidth: 1,
        borderColor: t.error,
        borderRadius: 13,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 10,
        paddingBottom: 10,
        marginTop: 8,
        marginBottom: 4,
      }}
    >
      <text style={{ fontSize: fs.sm, color: t.text }}>{`⚠ ${props.msg}`}</text>
    </div>
  );
}

/** Статическая кнопка (легаси-паритет: без обработчика, чисто визуально). */
function Btn(props: { t: WaveTheme; icon: IconName; label: string; primary?: boolean }) {
  const t = props.t;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: 14,
        paddingRight: 14,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: 99,
        borderWidth: 1,
        borderColor: props.primary ? t.magenta : t.border,
        backgroundColor: props.primary ? t.magenta : "transparent",
        cursor: "pointer",
        hover: { backgroundColor: props.primary ? t.violet : t.glass },
      }}
    >
      <Icon name={props.icon} size={14} color={props.primary ? t.userBubbleText : t.dim} />
      <text
        style={{
          fontSize: fs.sm,
          color: props.primary ? t.userBubbleText : t.text,
          whiteSpace: "nowrap",
        }}
      >
        {`${props.label}`}
      </text>
    </div>
  );
}

function Section(props: {
  t: WaveTheme;
  title: string;
  items: ExtensionInfo[];
  onFlip: (name: string, enabled: boolean) => void;
}) {
  if (props.items.length === 0) return null;
  const t = props.t;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <text
        style={{
          fontSize: fs.xs,
          color: t.dim,
          fontWeight: 650,
          marginTop: 16,
          marginBottom: 8,
          whiteSpace: "nowrap",
        }}
      >
        {`${props.title}`}
      </text>
      {props.items.map((x) => (
        <div
          key={x.name}
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
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
              <text
                style={{
                  fontSize: fs.base,
                  color: t.text,
                  fontWeight: 650,
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
              >
                {`${x.name}`}
              </text>
            </div>
            <Toggle checked={x.enabled} onChange={(v) => props.onFlip(x.name, v)} t={t} />
          </div>
          <text style={{ fontSize: fs.sm, color: t.dim }}>{`${x.description || "Без описания"}`}</text>
        </div>
      ))}
    </div>
  );
}

export function Extensions(props: { t: WaveTheme }) {
  const t = props.t;
  const [exts, setExts] = useState<ExtensionInfo[]>([]);
  const [error, setError] = useState("");

  const load = () => {
    try {
      setExts(getConfigSummary().extensions);
      setError("");
    } catch (e) {
      setError(String(e).slice(0, 120));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Оптимистичный toggle, откат при ошибке (паритет легаси) */
  const flip = (name: string, enabled: boolean) => {
    setExts((xs) => xs.map((x) => (x.name === name ? { ...x, enabled } : x)));
    try {
      toggleExtension(name, enabled);
    } catch (e) {
      setError(String(e).slice(0, 120));
      load();
    }
  };

  const bundled = exts.filter((x) => x.bundled || isDefault(x.name));
  const other = exts.filter((x) => !bundled.includes(x));

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
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="puzzle" size={18} color={t.magenta} />
        <text style={{ fontSize: fs.xl, color: t.text, fontWeight: 650, whiteSpace: "nowrap" }}>
          Расширения
        </text>
      </div>
      <text style={{ fontSize: fs.md, color: t.dim, marginTop: 6, marginBottom: 4 }}>
        Это расширения, являющиеся частью Model Context Protocol (MCP); они расширяют
        возможности Goose с помощью таких свободных контекстов, как промпты, ресурсы и
        инструментация.
      </text>

      {error ? <Banner t={t} msg={error} /> : null}

      <div style={{ display: "flex", flexDirection: "row", gap: 8, marginTop: 8, marginBottom: 4 }}>
        <Btn t={t} icon="plus" primary label="Добавить пользовательское расширение" />
        <Btn t={t} icon="puzzle" label="Просмотреть расширения" />
      </div>

      <Section
        t={t}
        title={`Расширения по умолчанию (${bundled.length})`}
        items={bundled}
        onFlip={flip}
      />
      <Section t={t} title={`Прочие (${other.length})`} items={other} onFlip={flip} />
    </div>
  );
}

export default Extensions;
