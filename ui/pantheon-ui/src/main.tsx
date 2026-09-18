// main.tsx — entry: тема по умолчанию, React-маунт, глобальный error-баннер (диагностика webkit)
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./theme.css";

function showErrorBanner(msg: string) {
  const el = document.getElementById("crash-banner") || document.createElement("div");
  el.id = "crash-banner";
  el.innerHTML = `
    <div style="position:fixed;inset:auto 10px 10px 10px;z-index:9999;background:#2a0a1f;border:1px solid #f6019d;border-radius:10px;padding:10px 14px;font:12px system-ui;color:#ffd9f2;max-height:40vh;overflow:auto">
      <b>⚠ Ошибка рендера (webview)</b><pre style="white-space:pre-wrap;margin:6px 0 0;font:11px ui-monospace">${msg
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      }</pre>
    </div>`;
  document.body.appendChild(el);
}
window.addEventListener("error", (e) => showErrorBanner(String(e.error ?? e.message)));
window.addEventListener("unhandledrejection", (e) => showErrorBanner(String(e.reason)));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
