// pantheon-ui: типы и bridge к Rust-бэкенду (Tauri invoke, с безопасным fallback вне Tauri)
import { isTauri } from "./acp";
const invoke = <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  isTauri()
    ? import("@tauri-apps/api/core").then((m) => m.invoke<T>(cmd, args))
    : Promise.reject(new Error("не в Tauri"));

export type Role = "goose" | "oracle" | "librarian";

export interface ChainStep {
  provider: string;
  model: string;
}

export interface AgentChain {
  role: Role;
  primary: ChainStep;
  fallbacks: ChainStep[];
}

export interface CatalogModel {
  name: string;
  context_limit?: number;
}

export interface ExtensionInfo {
  name: string;
  enabled: boolean;
  description: string;
  bundled: boolean;
}

export interface ConfigSummary {
  providers?: string[];
  active_provider: string;
  goose_model: string;
  goose_provider: string;
  goose_mode: string;
  extensions: ExtensionInfo[];
}

export interface SessionRow {
  id: string;
  title: string;
  session_type: string;
  updated_at: string;
  total_tokens: number;
  running: boolean;
}

export interface RecipeRow {
  file: string;
  title: string;
  description: string;
  path: string;
}

export interface Catalog {
  providers: string[];
  modelsByProvider: Record<string, CatalogModel[]>;
}

export interface ValidationResult {
  ok: boolean;
  status: number | null;
  error?: string;
  latency_ms: number;
}

export const getChains = (): Promise<AgentChain[]> =>
  invoke<AgentChain[]>("get_agent_chains").catch((e) => {
    // вне Tauri (браузер/dev) — демо-данные пресета подписки
    console.warn("[pantheon] getChains fallback (не Tauri?):", String(e).slice(0, 80));
    return structuredClone(PRESETS["OpenCode Go (подписка)"]);
  });

export const saveChain = (chain: AgentChain): Promise<void> =>
  invoke("save_agent_chain", {
    role: chain.role,
    chain: { primary: chain.primary, fallbacks: chain.fallbacks },
  });

export const getCatalog = (): Promise<Catalog> => invoke("get_provider_catalog");

export const validateStep = (step: ChainStep): Promise<ValidationResult> =>
  invoke("validate_chain_step", { step });

export const getRecentRuns = (): Promise<
  { session_id: string; role: string; status: string; task_summary: string; model: string }[]
> => invoke("get_recent_runs");

export const getArtifacts = (): Promise<
  { kind: string; path: string; topic: string; created_at: string }[]
> => invoke("get_artifacts");

export const getConfigSummary = (): Promise<ConfigSummary> =>
  invoke("get_config_summary");

export const toggleExtension = (name: string, enabled: boolean): Promise<void> =>
  invoke("toggle_extension", { name, enabled });

export const setActiveModel = (provider: string, model: string): Promise<void> =>
  invoke("set_active_model", { provider, model });

export const setGooseMode = (mode: string): Promise<void> =>
  invoke("set_goose_mode", { mode });

export const listSessions = (onlyRunning = false): Promise<SessionRow[]> =>
  invoke("list_sessions", { onlyRunning });

export const listRecipes = (): Promise<RecipeRow[]> => invoke("list_recipes");

// Пресеты цепочек (rev 2): OpenCode Go подписка по умолчанию
export const PRESETS: Record<string, AgentChain[]> = {
  "OpenCode Go (подписка)": [
    { role: "goose", primary: { provider: "opencode_go", model: "glm-5.3-flash" },
      fallbacks: [{ provider: "opencode_go", model: "glm-5.3" }] },
    { role: "oracle", primary: { provider: "opencode_go", model: "glm-5.3" },
      fallbacks: [
        { provider: "opencode_go", model: "kimi-k3" },
        { provider: "opencode_go", model: "gpt-5.6-luna" },
      ] },
    { role: "librarian", primary: { provider: "opencode_go", model: "deepseek-v4.1-flash" },
      fallbacks: [
        { provider: "opencode_go", model: "glm-5.3-flash" },
        { provider: "ollama_cloud", model: "deepseek-v4-flash:0731" },
      ] },
  ],
  "RouterAI": [
    { role: "goose", primary: { provider: "custom_routerai", model: "z-ai/glm-5.3-flash" },
      fallbacks: [] },
    { role: "oracle", primary: { provider: "opencode_go", model: "glm-5.3" },
      fallbacks: [{ provider: "custom_routerai", model: "z-ai/glm-5.3-flash" }] },
    { role: "librarian", primary: { provider: "custom_routerai", model: "z-ai/glm-5.3-flash" },
      fallbacks: [{ provider: "ollama_cloud", model: "deepseek-v4-flash:0731" }] },
  ],
};

// ── Планировщик / Приложения (goose data-dir) ──
export const getScheduledJobs = () => invoke<any[]>("get_scheduled_jobs");
export const getStoredApps = () => invoke<string[]>("list_stored_apps");
export const openApp = (name: string) => invoke<void>("open_app", { name });
