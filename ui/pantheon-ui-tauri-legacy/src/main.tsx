// main.tsx — entry: тема по умолчанию (авто по часу), React-маунт, глобальный error-баннер (диагностика webkit)
import ReactDOM from "react-dom/client";
import App from "./App";
import "./theme.css";

/** авто-тема: светлая 10:00–16:00, тёмная 16:00–10:00 */
function bootstrapTheme() {
  const saved = localStorage.getItem("pantheon-theme") ?? "auto";
  const h = new Date().getHours();
  const t = saved === "auto" ? (h >= 10 && h < 16 ? "light" : "dark") : saved;
  document.documentElement.dataset.theme = t;
}
bootstrapTheme();

function showErrorBanner(msg: string) {
  const el = document.getElementById("crash-banner") || document.createElement("div");
  el.id = "crash-banner";
  el.innerHTML = `
    <div style="position:fixed;inset:auto 10px 10px 10px;z-index:9999;background:#2a0a1f;border:1px solid #f6019d;border-radius:10px;padding:10px 14px;font:12px system-ui;color:#ffd9f2;max-height:40vh;overflow:auto">
      <b>⚠ Ошибка рендера (webview)</b><pre style="white-space:pre-wrap;margin:6px 0 0;font:11px system-ui">${msg
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      }</pre>
    </div>`;
  document.body.appendChild(el);
}
window.addEventListener("error", (e) => {
  const stack = (e.error as Error)?.stack;
  showErrorBanner(String(e.error ?? e.message) + (stack ? "\n" + stack : ""));
});
window.addEventListener("unhandledrejection", (e) => {
  const r: any = e.reason;
  showErrorBanner(String(r?.stack ?? r ?? "unknown rejection"));
});

// StrictMode OFF: dev double-mount гонял auto-connect эффект (start → cleanup stop → guard блокировал
// рестарт) и убивал goose serve sidecar до первого промпта — «упал при отправке».
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
