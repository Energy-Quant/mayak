// Keyboard — "Keyboard" tab: hotkeys come later (empty state, GPUIX).
// goose configs contain no hotkey data — no table until the data appears.
import { Icon } from "./Icon";
import { fs, type WaveTheme } from "../tokens";

export default function Keyboard(props: { t: WaveTheme }) {
  const t = props.t;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 32,
        marginTop: 16,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.glass,
      }}
    >
      <Icon name="settings" size={40} color={t.faint} />
      <text style={{ fontSize: fs.lg, color: t.text, fontWeight: 650, textAlign: "center" }}>
        Клавиатура
      </text>
      <text style={{ fontSize: fs.md, color: t.dim, textAlign: "center" }}>
        Настройка горячих клавиш — позже.
      </text>
      <text style={{ fontSize: fs.sm, color: t.faint, textAlign: "center" }}>
        В конфигурации goose пока нет данных о хоткеях
      </text>
    </div>
  );
}
