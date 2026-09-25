/**
 * Маяк — точка входа GPUIX (порт app.tsx: окно + App + window-key handler).
 */
import { render } from "@gpuix/react";
import App from "./src/App";
import { winKeys } from "./src/windowKeys";

render(<App />, {
  title: "Маяк",
  width: 1280,
  height: 840,
  onKeyDown: (e) => { winKeys.chat?.(e); winKeys.handler?.(e); },
});
