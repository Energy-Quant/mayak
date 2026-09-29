// Icon — контурные минималистичные иконки (lucide-геометрия, stroke 1.6, без заливки)
export type IconName =
  | "plus" | "clipboard" | "settings" | "app" | "puzzle" | "clock"
  | "history" | "minus" | "square" | "x" | "goose" | "chevron-down";

const PATHS: Record<IconName, JSX.Element> = {
  plus: <path d="M12 5v14M5 12h14" />,
  clipboard: (
    <>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  app: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 4v5" />
    </>
  ),
  puzzle: (
    <path d="M9 3a2 2 0 0 1 4 0v2h4a1 1 0 0 1 1 1v4h2a2 2 0 0 1 0 4h-2v4a1 1 0 0 1-1 1h-4v-2a2 2 0 0 0-4 0v2H5a1 1 0 0 1-1-1v-4h2a2 2 0 0 0 0-4H4V6a1 1 0 0 1 1-1h4V3z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  square: <rect x="6" y="6" width="12" height="12" rx="1" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  goose: (
    <path d="M8 20c-2.2 0-4-1.8-4-4 0-2.5 2-4 4-4V7a3 3 0 0 1 5.9-.7L19 8l-3 2v2c0 4-2.5 8-8 8z" />
  ),
  "chevron-down": <path d="M6 9l6 6 6-6" />,
};

export function Icon(props: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[props.name]}
    </svg>
  );
}
