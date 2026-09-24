import { useState } from 'react'
import { render } from '@gpuix/react'

function App() {
  const [count, setCount] = useState(0)
  return (
    <div
      style={{
        padding: 24,
        backgroundColor: '#171329',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div style={{ alignItems: 'center', gap: 12 }}>
        <text style={{ color: '#f291b9', fontSize: 28 }}>Маяк</text>
        <text style={{ color: '#a79ecd', fontSize: 13 }}>
          GPUIX 0.10.0 · без webview · ex-Пантеон
        </text>
        <div
          onClick={() => setCount((c) => c + 1)}
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            cursor: 'pointer',
            backgroundColor: '#272144',
            hover: { backgroundColor: '#2e2650' },
          }}
        >
          <text style={{ color: '#efeaf9' }}>Кликов: {count}</text>
        </div>
      </div>
    </div>
  )
}

render(<App />, { title: 'Маяк', width: 720, height: 420 })
