import { useEffect, useState } from 'react'
import { render } from '@gpuix/react'
import { autoTheme, dark, fs, font, light, type ThemeMode, type WaveTheme } from './src/tokens'

const LS_KEY = 'mayak-theme'

function loadMode(): ThemeMode {
  // dev/smoke: MAYAK_THEME=light|dark принудительно (для скриншотов и automation)
  const forced = globalThis.process?.env?.MAYAK_THEME
  if (forced === 'light' || forced === 'dark') return forced
  const saved = globalThis.localStorage?.getItem(LS_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return autoTheme()
}

function App() {
  const [mode, setMode] = useState<ThemeMode>(loadMode)
  const [count, setCount] = useState(0)
  const t: WaveTheme = mode === 'light' ? light : dark

  useEffect(() => {
    globalThis.localStorage?.setItem(LS_KEY, mode)
  }, [mode])

  const toggle = () => setMode((m) => (m === 'dark' ? 'light' : 'dark'))

  return (
    <div
      style={{
        height: '100%',
        backgroundColor: t.bg,
        padding: 24,
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <text style={{ color: t.magenta, fontSize: 28, fontFamily: font }}>Маяк</text>
      <text style={{ color: t.dim, fontSize: fs.md, fontFamily: font }}>
        GPUIX 0.10.0 · без webview · ex-Пантеон · тема {mode === 'dark' ? 'Малиновый закат' : 'Полдень у залива'}
      </text>

      <div
        onClick={() => setCount((c) => c + 1)}
        style={{
          marginTop: 8,
          padding: 12,
          borderRadius: 9,
          cursor: 'pointer',
          backgroundColor: t.raised,
          borderWidth: 1,
          borderColor: t.border,
          hover: { backgroundColor: t.surface },
        }}
      >
        <text style={{ color: t.text, fontSize: fs.base, fontFamily: font }}>Кликов: {count}</text>
      </div>

      <div
        onClick={toggle}
        style={{
          marginTop: 4,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 16,
          paddingRight: 16,
          alignSelf: 'flex-start',
          borderRadius: 13,
          cursor: 'pointer',
          backgroundColor: t.navActive,
          borderWidth: 1,
          borderColor: t.borderStrong,
          hover: { backgroundColor: t.glass },
        }}
      >
        <text style={{ color: t.magenta, fontSize: fs.sm, fontFamily: font }}>
          Переключить тему → {mode === 'dark' ? 'light' : 'dark'}
        </text>
      </div>

      {/* образец поверхностей для проверки контраста */}
      <div style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        {(
          [
            ['surface', t.surface],
            ['raised', t.raised],
            ['glass', t.glass],
          ] as const
        ).map(([name, bg]) => (
          <div
            key={name}
            style={{
              padding: 10,
              borderRadius: 9,
              backgroundColor: bg,
              borderWidth: 1,
              borderColor: t.border,
            }}
          >
            <text style={{ color: t.text, fontSize: fs.sm, fontFamily: font }}>{name}</text>
            <text style={{ color: t.dim, fontSize: fs.xs, fontFamily: font }}>dim-текст читаем</text>
            <text style={{ color: t.faint, fontSize: fs.xs, fontFamily: font }}>faint-текст читаем</text>
          </div>
        ))}
      </div>
    </div>
  )
}

render(<App />, { title: 'Маяк', width: 720, height: 480 })
