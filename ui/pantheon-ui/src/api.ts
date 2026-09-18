// pantheon-ui: типы и bridge к Rust-бэкенду (Tauri invoke)
import { invoke } from "@tauri-apps/api/core";

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
  invoke("get_agent_chains");

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
