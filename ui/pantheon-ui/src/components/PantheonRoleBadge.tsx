// PantheonRoleBadge — индикатор активной личности (Патч 1 из плана)
import React from "react";

export interface BadgeProps {
  role: "goose" | "oracle" | "librarian" | string;
  model?: string;
  cost?: "CHEAP" | "MEDIUM" | "EXPENSIVE";
  readonly?: boolean;
  fallbackFired?: string; // описание сработавшего fallback: "glm-5.3 → kimi-k3 (provider error)"
}

export const ROLE_META: Record<string, { icon: string; label: string }> = {
  goose: { icon: "🪿", label: "Goose" },
  oracle: { icon: "🔥", label: "Оракул" },
  librarian: { icon: "📚", label: "Библиотекарь" },
};

export default function PantheonRoleBadge({ role, model, cost, readonly, fallbackFired }: BadgeProps) {
  const meta = ROLE_META[role] ?? { icon: "❔", label: role };
  return (
    <span className={`role-badge${fallbackFired ? " fallback-fired" : ""}`} data-role={role}>
      <span className="role-dot" />
      <span>{meta.icon} {meta.label}</span>
      {(model || cost || readonly) && (
        <span className="role-meta">
          {[cost, model, readonly ? "read-only" : null].filter(Boolean).join(" · ")}
        </span>
      )}
      {fallbackFired && <span className="role-meta" title="Сработал fallback">⚡ {fallbackFired}</span>}
    </span>
  );
}
