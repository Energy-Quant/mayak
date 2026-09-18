// Keyboard — вкладка Клавиатура: хоткеи приложения (реально работают в окне) + плейсхолдеры глобальных
import { useEffect, useState } from "react";

const HOTKEYS: { keys: string; desc: string; global?: boolean }[] = [
  { keys: "Ctrl+N", desc: "Новый чат" },
  { keys: "Ctrl+K", desc: "Командная палитра (поиск по разделам)" },
  { keys: "Ctrl+[", desc: "Переключить сайдбар" },
  { keys: "Esc", desc: "Закрыть субагент-панель" },
  { keys: "Ctrl+1..9", desc: "Быстрый переход по разделам" },
  { keys: "Ctrl+Alt+N", desc: "Новый чат (глобально)", global: true },
  { keys: "Ctrl+Alt+S", desc: "Настройки (глобально)", global: true },
];

export default function Keyboard() {
  const [note, setNote] = useState("");
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === "n" && e.altKey) { e.preventDefault(); (window as any).__pantheon_nav?.("chat"); }
      else if (k === "s" && e.altKey) { e.preventDefault(); (window as any).__pantheon_nav?.("settings"); }
      else if (k === "k") { e.preventDefault(); setNote("Командная палитра — в следующей итерации."); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div className="page">
      <h2>Клавиатура</h2>
      <div className="page-hint">Хоткеи приложения работают внутри окна. Глобальные требуют плагина в системе (tauri global-shortcut) — зарезервировано.</div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Комбинация</th><th>Действие</th><th>Тип</th></tr></thead>
          <tbody>
            {HOTKEYS.map((h, i) => (
              <tr key={i}>
                <td><kbd>{h.keys}</kbd></td>
                <td>{h.desc}</td>
                <td className="dim">{h.global ? "глобальный (скоро)" : "в окне"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <div className="empty">{note}</div>}
    </div>
  );
}
