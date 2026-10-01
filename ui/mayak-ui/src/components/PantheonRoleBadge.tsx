/**
 * PantheonRoleBadge — active personality indicator (port without DOM).
 */
export interface BadgeProps {
  role: "goose" | "oracle" | "librarian" | string;
  model?: string;
  cost?: "CHEAP" | "MEDIUM" | "EXPENSIVE";
  readonly?: boolean;
  fallbackFired?: string;
}

export const ROLE_META: Record<string, { icon: string; label: string }> = {
  goose: { icon: "🪿", label: "Goose" },
  oracle: { icon: "🔥", label: "Оракул" },
  librarian: { icon: "📚", label: "Библиотекарь" },
};

export default function PantheonRoleBadge(props: {
  badge: BadgeProps;
  colors: { surface: string; border: string; text: string; dim: string; cyan: string; magenta: string; violet: string; gold: string };
  fontSize: number;
}) {
  const { role, model, cost, readonly, fallbackFired } = props.badge;
  const c = props.colors;
  const dot =
    role === "oracle" ? c.magenta : role === "librarian" ? c.violet : c.cyan;
  const meta = ROLE_META[role] ?? { icon: "❔", label: role };
  const metaLine = [cost, model, readonly ? "read-only" : null].filter(Boolean).join(" · ");
  return (
    <div
      data-role={role}
      style={{display: "flex", 
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 14,
        paddingRight: 14,
        paddingTop: 5,
        paddingBottom: 5,
        borderRadius: 99,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: fallbackFired ? c.gold : c.border,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: dot,
        }}
      />
      <text style={{ fontSize: props.fontSize, color: c.text, whiteSpace: "nowrap" }}>
        {`${meta.icon} ${meta.label}`}
      </text>
      {metaLine ? (
        <text style={{ fontSize: props.fontSize - 1.5, color: c.dim, whiteSpace: "nowrap" }}>{metaLine}</text>
      ) : null}
      {fallbackFired ? (
        <text style={{ fontSize: props.fontSize - 1.5, color: c.gold, whiteSpace: "nowrap" }}>{`⚡ ${fallbackFired}`}</text>
      ) : null}
    </div>
  );
}
