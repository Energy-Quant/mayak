/**
 * api/config.ts — port of config.rs + chains from pantheon.rs (TOML) to TS.
 * yaml/toml writes keep a backup (parity). The config path can be overridden
 * by argument for tests only (the frontend never passes it — canonical path).
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { homedir } from "node:os";
import { join } from "node:path";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { kvSet } from "./db";
import { log } from "../logger";
import { AppError, E } from "../errors";

export const configPath = () => join(homedir(), ".config/goose/config.yaml");
export const promptsDir = () => join(homedir(), ".config/goose/prompts");
export const pantheonTomlPath = () => join(homedir(), ".config/goose/pantheon.toml");

const readCfg = (p?: string) => readFileSync(p ?? configPath(), "utf8");

function backupAndWrite(path: string, raw: string, out: string, suffix: string): void {
  const ts = Math.floor(Date.now() / 1000);
  writeFileSync(`${path}.${suffix}-${ts}`, raw);
  writeFileSync(path, out);
}

// ── Config summary (get_config_summary) ──

export interface ExtensionEntry {
  name: string;
  enabled: boolean;
  description: string;
  bundled: boolean;
}
export interface GooseConfigSummary {
  active_provider: string;
  goose_model: string;
  goose_provider: string;
  goose_mode: string;
  extensions: ExtensionEntry[];
  providers: string[];
}

type YamlObj = Record<string, unknown>;

export function readSummary(cfgPath?: string): GooseConfigSummary {
  const v = parseYaml(readCfg(cfgPath)) as YamlObj;
  const extMap = (v.extensions ?? {}) as YamlObj;
  const extensions: ExtensionEntry[] = Object.entries(extMap).map(([name, e]) => {
    const entry = (e ?? {}) as YamlObj;
    return {
      name,
      enabled: entry.enabled === true,
      description: typeof entry.description === "string" ? entry.description : "",
      bundled: entry.bundled === true,
    };
  });
  const provMap = (v.providers ?? {}) as YamlObj;
  const providers = Object.entries(provMap)
    .filter(([, e]) => (e as YamlObj)?.enabled === true)
    .map(([k]) => k);
  return {
    providers,
    active_provider: typeof v.active_provider === "string" ? v.active_provider : "",
    goose_model: typeof v.GOOSE_MODEL === "string" ? v.GOOSE_MODEL : "",
    goose_provider: typeof v.GOOSE_PROVIDER === "string" ? v.GOOSE_PROVIDER : "",
    goose_mode: typeof v.GOOSE_MODE === "string" ? v.GOOSE_MODE : "auto",
    extensions,
  };
}

/** JSON shape of the get_config_summary command (no providers — as in main.rs) */
export function getConfigSummary(cfgPath?: string): Omit<GooseConfigSummary, "providers"> {
  const s = readSummary(cfgPath);
  return {
    active_provider: s.active_provider,
    goose_model: s.goose_model,
    goose_provider: s.goose_provider,
    goose_mode: s.goose_mode,
    extensions: s.extensions,
  };
}

export function toggleExtension(name: string, enabled: boolean, cfgPath?: string): void {
  const path = cfgPath ?? configPath();
  const raw = readCfg(path);
  const v = parseYaml(raw) as YamlObj;
  const ext = v.extensions as YamlObj | undefined;
  if (!ext) throw new AppError(E.CONFIG_SECTION, "нет секции extensions в config.yaml");
  if (!(name in ext)) throw new AppError(E.CONFIG_EXT_MISSING, `расширение ${name} не найдено`, { context: { name } });
  (ext[name] as YamlObj).enabled = enabled;
  backupAndWrite(path, raw, stringifyYaml(v), "yaml.bak-mayak");
}

export function setActiveModel(provider: string, model: string, cfgPath?: string): void {
  const path = cfgPath ?? configPath();
  const raw = readCfg(path);
  const v = parseYaml(raw) as YamlObj;
  v.GOOSE_PROVIDER = provider;
  v.GOOSE_MODEL = model;
  v.active_provider = provider;
  backupAndWrite(path, raw, stringifyYaml(v), "yaml.bak-mayak");
}

/**
 * Real goose 1.52 enum GooseMode — verified via `strings` on the binary
 * (GooseModeapprovesmart_approve / configure screen Auto·Approve·Smart Approve·Chat).
 * There is no "manual" or "chat_only" variant: unknown values fail with
 * "Failed to parse GooseMode variant".
 */
export const GOOSE_MODES = ["auto", "approve", "smart_approve", "chat"] as const;

/** Current GOOSE_MODE from config.yaml (readSummary defaults to "auto"). */
export function getGooseMode(cfgPath?: string): string {
  return readSummary(cfgPath).goose_mode;
}

/**
 * Live-session hook: acp.ts subscribes here so a mode change from Settings
 * reaches the running session via ACP session/set_mode, not only config.yaml
 * (which only affects sessions started later).
 */
export type GooseModeListener = (mode: string) => void;
let gooseModeListener: GooseModeListener | null = null;
export function setGooseModeListener(fn: GooseModeListener | null): void {
  gooseModeListener = fn;
}

export function setGooseMode(mode: string, cfgPath?: string): void {
  if (!(GOOSE_MODES as readonly string[]).includes(mode)) throw new AppError(E.CONFIG_BAD_MODE, `неизвестный режим: ${mode}`, { context: { mode } });
  const path = cfgPath ?? configPath();
  const raw = readCfg(path);
  const v = parseYaml(raw) as YamlObj;
  v.GOOSE_MODE = mode;
  // parity with config.rs: set_goose_mode writes without a backup
  writeFileSync(path, stringifyYaml(v));
  // Only canonical writes (UI) notify the live session; test paths stay silent.
  if (!cfgPath) gooseModeListener?.(mode);
}

// ── Prompts: ~/.config/goose/prompts ──

export const PROMPT_FILES = [
  "system.md",
  "compaction.md",
  "subagent_system.md",
  "apps_create.md",
  "apps_iterate.md",
  "permission_judge.md",
  "tiny_model_system.md",
] as const;

export interface PromptFileInfo {
  name: string;
  exists: boolean;
}

function checkPromptName(name: string): void {
  if (!(PROMPT_FILES as readonly string[]).includes(name)) {
    throw new AppError(E.CONFIG_BAD_NAME, `недопустимое имя файла: ${name}`, { context: { name } });
  }
}

export function listPromptFiles(): PromptFileInfo[] {
  const dir = promptsDir();
  return PROMPT_FILES.map((name) => ({
    name,
    exists: existsSync(join(dir, name)),
  }));
}

export function readPromptFile(name: string): string {
  checkPromptName(name);
  const p = join(promptsDir(), name);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

export function savePromptFile(name: string, content: string): void {
  checkPromptName(name);
  const dir = promptsDir();
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  if (existsSync(p)) copyFileSync(p, join(dir, `${name}.bak`));
  writeFileSync(p, content);
}

// ── Recipes: ~/.config/goose/recipes/*.yaml (parity with list_recipes) ──

export interface RecipeRow {
  file: string;
  title: string;
  description: string;
  path: string;
}

export function listRecipes(): RecipeRow[] {
  const dir = join(homedir(), ".config/goose/recipes");
  const out: RecipeRow[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch (e) {
    log.warn("config.listRecipes.readdir", `dir=${dir} ${e instanceof Error ? e.message : e}`);
    return out;
  }
  for (const f of entries) {
    if (!f.endsWith(".yaml") && !f.endsWith(".yml")) continue;
    const full = join(dir, f);
    let raw = "";
    try {
      raw = readFileSync(full, "utf8");
    } catch (e) {
      log.warn("config.listRecipes.read", `${f} ${e instanceof Error ? e.message : e}`);
      raw = "";
    }
    const pick = (key: string): string => {
      const line = raw.split("\n").find((l) => l.startsWith(`${key}:`));
      return line ? line.slice(key.length + 1).trim() : "";
    };
    out.push({ file: f, title: pick("title"), description: pick("description"), path: full });
  }
  return out;
}

/** Open a goose HTML app (xdg-open) — parity with open_app */
export function openApp(name: string): void {
  const path = join(homedir(), `.local/share/goose/apps/${name}.html`);
  if (!existsSync(path)) throw new AppError(E.CONFIG_NOT_FOUND, `${name} не найден`, { context: { name, path } });
  const r = spawnSync("xdg-open", [path], { stdio: "ignore" });
  if (r.error) throw new AppError(E.CONFIG_WRITE, String(r.error), { context: { name } });
}

// ── App: paths and limits ──

export interface ConfigPaths {
  config_path: string;
  config_dir: string;
  prompts_dir: string;
}

export function getConfigPaths(): ConfigPaths {
  const p = configPath();
  return {
    config_path: p,
    config_dir: join(p, ".."),
    prompts_dir: promptsDir(),
  };
}

export interface ConfigLimits {
  goose_max_turns: number | null;
  goose_auto_compact_threshold: number | null;
}

export function getConfigLimits(cfgPath?: string): ConfigLimits {
  const v = parseYaml(readCfg(cfgPath)) as YamlObj;
  const mt = v.GOOSE_MAX_TURNS;
  const th = v.GOOSE_AUTO_COMPACT_THRESHOLD;
  return {
    goose_max_turns: typeof mt === "number" && Number.isInteger(mt) && mt >= 0 ? mt : null,
    goose_auto_compact_threshold: typeof th === "number" ? th : null,
  };
}

export function openConfigDir(): void {
  spawnSync("xdg-open", [join(configPath(), "..")], { stdio: "ignore" });
}

// ── Model chains: pantheon.toml (ported from pantheon.rs) ──

export type Role = "goose" | "oracle" | "librarian";
export const ROLES: Role[] = ["goose", "oracle", "librarian"];

export interface ChainStep {
  provider: string;
  model: string;
}
export interface AgentChainToml {
  primary: ChainStep;
  fallbacks: ChainStep[];
}
export interface AgentChainJson {
  role: Role;
  primary: ChainStep;
  fallbacks: ChainStep[];
}

export function getAgentChains(tomlPath?: string): AgentChainJson[] {
  const path = tomlPath ?? pantheonTomlPath();
  const raw = readFileSync(path, "utf8");
  const parsed = parseToml(raw) as { agents?: Record<string, unknown> };
  const agents = parsed.agents ?? {};
  const out: AgentChainJson[] = [];
  for (const role of ROLES) {
    const c = agents[role] as { primary?: ChainStep; fallbacks?: ChainStep[] } | undefined;
    if (!c) continue;
    out.push({
      role,
      primary: { provider: c.primary?.provider ?? "", model: c.primary?.model ?? "" },
      fallbacks: (c.fallbacks ?? []).map((f) => ({ provider: f.provider, model: f.model })),
    });
  }
  return out;
}

/** Role → runtime files (agent frontmatter + recipe). goose has no md/recipe. */
const ROLE_RUNTIME: Record<string, { agent?: string; recipe?: string }> = {
  goose: {},
  oracle: { agent: "oracle.md", recipe: "oracle-consult.yaml" },
  librarian: { agent: "librarian.md", recipe: "librarian-research.yaml" },
};

/**
 * P1 auto-sync: a model change in the UI must reach the delegate.
 * Model precedence in goose: recipe.settings.goose_model → frontmatter → override.
 * Write BOTH, otherwise the old model keeps working (lesson glm-5.3→mimo).
 */
function syncModelToRuntime(role: string, step: ChainStep): void {
  const rt = ROLE_RUNTIME[role];
  if (!rt) return;

  // 1. agent frontmatter ~/.agents/agents/<agent>.md
  if (rt.agent) {
    const agentPath = join(homedir(), ".agents/agents", rt.agent);
    try {
      if (existsSync(agentPath)) {
        let text = readFileSync(agentPath, "utf8");
        // frontmatter block: from the first --- line to the second --- 
        const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch && /(^|\n)model:\s*[^\n]+/.test(fmMatch[1])) {
          const fmNew = fmMatch[1].replace(/(^|\n)model:\s*[^\n]+/, `$1model: ${step.model}`);
          text = text.replace(fmMatch[0], `---\n${fmNew}\n---`);
          writeFileSync(agentPath, text);
          log.info("config.syncAgentFrontmatter", `${rt.agent} model=${step.model}`);
        } else {
          log.warn("config.syncAgentFrontmatter", `frontmatter/model не найдены в ${rt.agent}`);
        }
      }
    } catch (e) {
      log.fail("config.syncAgentFrontmatter", e);
    }
  }

  // 2. recipe ~/.config/goose/recipes/<recipe>.yaml — settings.goose_model
  if (rt.recipe) {
    const recipePath = join(homedir(), ".config/goose/recipes", rt.recipe);
    try {
      if (existsSync(recipePath)) {
        let text = readFileSync(recipePath, "utf8");
        const before = text;
        // goose_model: <value> inside settings
        text = text.replace(/^(\s*goose_model:)\s*[^\n]+/m, `$1 ${step.model}`);
        text = text.replace(/^(\s*goose_provider:)\s*[^\n]+/m, `$1 ${step.provider}`);
        if (text !== before) {
          writeFileSync(recipePath, text);
          log.info("config.syncRecipe", `${rt.recipe} model=${step.model} provider=${step.provider}`);
        }
      }
    } catch (e) {
      log.fail("config.syncRecipe", e);
    }
  }
}

export function saveAgentChain(role: string, chain: AgentChainToml, tomlPath?: string): void {
  if (!(ROLES as string[]).includes(role)) throw new AppError(E.CONFIG_BAD_ROLE, `неизвестная роль: ${role}`, { context: { role } });
  const path = tomlPath ?? pantheonTomlPath();
  let parsed: { agents?: Record<string, unknown> } = {};
  try {
    parsed = parseToml(readFileSync(path, "utf8")) as typeof parsed;
  } catch (e) {
    log.warn("config.saveAgentChain.parse", `${path} ${e instanceof Error ? e.message : e}`);
    parsed = {};
  }
  if (!parsed.agents) parsed.agents = {};
  parsed.agents[role] = { primary: chain.primary, fallbacks: chain.fallbacks };
  const ser = stringifyToml(parsed);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, ser);
  renameSync(tmp, path);
  // P1: auto-sync — the model must reach the delegate (frontmatter + recipe)
  syncModelToRuntime(role, chain.primary);
  // audit in kv (parity with pantheon.rs)
  kvSet(
    `chain-edit:${Math.floor(Date.now() / 1000)}`,
    `${role}: primary=${chain.primary.provider}/${chain.primary.model} fallbacks=${JSON.stringify(chain.fallbacks)}`,
  );
}
