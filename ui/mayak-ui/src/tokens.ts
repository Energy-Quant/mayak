/**
 * Mayak theme tokens — "Wave" / "Sea Inside" (rev9 from legacy theme.css).
 * GPUIX draws with style objects, not CSS: gradients/blur do NOT port 1:1.
 * light/dark switching — no reload (useState in App).
 */

export type ThemeMode = 'light' | 'dark'

export interface WaveTheme {
  bg: string
  bgTop: string
  bgBottom: string
  surface: string
  raised: string
  glass: string
  glassHi: string
  text: string
  dim: string
  faint: string
  magenta: string
  violet: string
  cyan: string
  sky: string
  gold: string
  green: string
  error: string
  border: string
  borderStrong: string
  /** muted nav/tab-active background (replaces grad-nav) */
  navActive: string
  userBubble: string
  userBubbleText: string
  selection: string
}

/** "Crimson sunset" — dark 16:00–10:00 */
export const dark: WaveTheme = {
  bg: '#14122a',
  bgTop: '#1a1330',
  bgBottom: '#2a1a36',
  surface: '#2a203a',
  raised: '#402e52',
  glass: 'rgba(255,255,255,0.05)',
  glassHi: 'rgba(255,255,255,0.08)',
  text: '#f4edf3',
  dim: '#b3a3c0',
  faint: '#7c6b90',
  magenta: '#ff4f8b',
  violet: '#c56ee0',
  cyan: '#6fd6d2',
  sky: '#8aa2f0',
  gold: '#ff8a5c',
  green: '#7dd6a8',
  error: '#ff5c7a',
  border: 'rgba(212,130,180,0.18)',
  borderStrong: 'rgba(255,79,139,0.42)',
  navActive: 'rgba(255,79,139,0.14)',
  userBubble: '#ff4f8b',
  userBubbleText: '#1a1330',
  selection: 'rgba(255,79,139,0.35)',
}

/** "Bay noon" — light 10:00–16:00 */
export const light: WaveTheme = {
  bg: '#c5c8dd',
  bgTop: '#b7bed8',
  bgBottom: '#ddd0cc',
  surface: '#e6e2ec',
  raised: '#fffdfc',
  glass: 'rgba(255,255,255,0.45)',
  glassHi: 'rgba(255,255,255,0.9)',
  text: '#2c2a42',
  dim: '#565674',
  faint: '#8d8ba6',
  magenta: '#c56b92',
  violet: '#7278b8',
  cyan: '#459a96',
  sky: '#6880c2',
  gold: '#d08a5e',
  green: '#4a9e86',
  error: '#c24562',
  border: 'rgba(70,68,105,0.22)',
  borderStrong: 'rgba(104,128,194,0.52)',
  navActive: 'rgba(114,120,184,0.16)',
  userBubble: '#c56b92',
  userBubbleText: '#ffffff',
  selection: 'rgba(197,107,146,0.35)',
}

export const themes: Record<ThemeMode, WaveTheme> = { dark, light }

/** Auto theme by hour: 10:00–16:00 light, otherwise dark (like bootstrapTheme in legacy). */
export function autoTheme(d = new Date()): ThemeMode {
  const h = d.getHours()
  return h >= 10 && h < 16 ? 'light' : 'dark'
}

/** Typographic scale (module ~1.2, from theme.css). */
export const fs = {
  xs2: 10.5,
  xs: 11.5,
  sm: 12.5,
  md: 13.5,
  base: 14.5,
  lg: 16,
  xl: 20,
  xxl: 26,
  hero: 60,
} as const

/** Spacing rhythm. */
export const sp = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const

/** Radii. */
export const r = { xs: 6, sm: 9, md: 13, lg: 17, xl: 24 } as const

/** Single typeface (set system-wide; fallback to GPUI default). */
export const font = 'Nineteen Ninety Three'
