import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./theme.css";

// тема по умолчанию (переключатель тем — Phase 3)
document.documentElement.dataset.theme = "dreamwave-night";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
