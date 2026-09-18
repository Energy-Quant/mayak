import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri: фиксированный порт 1420 (tauri.conf.json devUrl)
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
  },
});
