/**
 * api/config.ts — порт config.rs + цепочки из pantheon.rs (TOML) на TS.
 * Запись yaml/toml — с бэкапом (паритет). Путь конфига можно переопределить
 * аргументом только для тестов (фронт не передаёт — канонический путь).
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

// ── Сводка конфига (get_config_summary) ──

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

/** JSON-формат команды get_config_summary (без providers — как в main.rs) */
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

const GOOSE_MODES = ["auto", "approve", "manual", "chat", "chat_only"];

export function setGooseMode(mode: string, cfgPath?: string): void {
  if (!GOOSE_MODES.includes(mode)) throw new AppError(E.CONFIG_BAD_MODE, `неизвестный режим: ${mode}`, { context: { mode } });
  const path = cfgPath ?? configPath();
  const raw = readCfg(path);
  const v = parseYaml(raw) as YamlObj;
  v.GOOSE_MODE = mode;
  // паритет config.rs: set_goose_mode без бэкапа
  writeFileSync(path, stringifyYaml(v));
}

// ── Программы: промпты ~/.config/goose/prompts ──

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

// ── Рецепты: ~/.config/goose/recipes/*.yaml (паритет list_recipes) ──

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

/** Открыть HTML-приложение goose (xdg-open) — паритет open_app */
export function openApp(name: string): void {
  const path = join(homedir(), `.local/share/goose/apps/${name}.html`);
  if (!existsSync(path)) throw new AppError(E.CONFIG_NOT_FOUND, `${name} не найден`, { context: { name, path } });
  const r = spawnSync("xdg-open", [path], { stdio: "ignore" });
  if (r.error) throw new AppError(E.CONFIG_WRITE, String(r.error), { context: { name } });
}

// ── Приложение: пути и лимиты ──

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

// ── Цепочки моделей: pantheon.toml (роей из pantheon.rs) ──

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
  // аудит в kv (паритет pantheon.rs)
  kvSet(
    `chain-edit:${Math.floor(Date.now() / 1000)}`,
    `${role}: primary=${chain.primary.provider}/${chain.primary.model} fallbacks=${JSON.stringify(chain.fallbacks)}`,
  );
}
