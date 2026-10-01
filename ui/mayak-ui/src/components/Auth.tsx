// Auth — "Authorization" tab: key management comes later (empty state, GPUIX).
// The UI never shows API key values — goose stores them in the system keyring.
import { Icon } from "./Icon";
import { fs, type WaveTheme } from "../tokens";

export default function Auth(props: { t: WaveTheme }) {
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
      <Icon name="app" size={40} color={t.faint} />
      <text style={{ fontSize: fs.lg, color: t.text, fontWeight: 650, textAlign: "center" }}>
        Авторизация
      </text>
      <text style={{ fontSize: fs.md, color: t.dim, textAlign: "center" }}>
        Управление ключами провайдеров — позже.
      </text>
      <text style={{ fontSize: fs.sm, color: t.faint, textAlign: "center" }}>
        Ключи хранятся в системном брелоке, значения UI не раскрывает
      </text>
    </div>
  );
}
