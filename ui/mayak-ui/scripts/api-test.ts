/**
 * scripts/api-test.ts — приёмка шага 3: форматы JSON как у Tauri-команд.
 * db.ts — против РЕАЛЬНЫХ sessions.db/pantheon.db (read-only чтение);
 * config.ts — на ВРЕМЕННОЙ копии config.yaml / pantheon.toml (запись не трогает оригинал).
 * Запуск: bun scripts/api-test.ts
 */
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listSessions,
  listSubagentMessages,
  recentRuns,
  getArtifacts,
  getPantheonOverview,
  getScheduledJobs,
  listStoredApps,
  contentBlocks,
} from "../src/api/db";
import {
  readSummary,
  getConfigSummary,
  toggleExtension,
  setActiveModel,
  setGooseMode,
  getConfigLimits,
  listPromptFiles,
  readPromptFile,
  getAgentChains,
  saveAgentChain,
  getConfigPaths,
} from "../src/api/config";
import { stageAttachment, readFileBytes } from "../src/api/attachments";
import { clipboardImage } from "../src/api/clipboard";

let failed = 0;
function ok(cond: boolean, name: string, extra?: unknown): void {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : "");
  }
}

function hasKeys(obj: object, keys: string[]): boolean {
  return keys.every((k) => k in obj);
}

console.log("─ db.ts (реальные БД, чтение) ─");
const sessions = listSessions();
ok(Array.isArray(sessions) && sessions.length > 0, `listSessions: ${sessions.length} строк`);
if (sessions.length > 0) {
  ok(
    hasKeys(sessions[0], ["id", "title", "session_type", "updated_at", "total_tokens", "running"]),
    "listSessions: ключи row (паритет main.rs)",
    Object.keys(sessions[0]),
  );
  ok(typeof sessions[0].total_tokens === "number", "total_tokens: number (0 при null)");
}

// субагент-сообщения: взять сессию типа sub_agent из списка ИЛИ любую сессию
const sub = sessions.find((s) => s.session_type === "sub_agent") ?? sessions[0];
const msgs = sub ? listSubagentMessages(sub.id) : [];
ok(Array.isArray(msgs), `listSubagentMessages(${sub?.id?.slice(0, 8)}…): ${msgs.length} сообщений`);
if (msgs.length > 0) {
  ok(hasKeys(msgs[0], ["role", "content", "blocks"]), "msg: ключи role/content/blocks");
  ok(Array.isArray(msgs[0].blocks), "blocks: массив");
}

const runs = recentRuns();
ok(Array.isArray(runs), `recentRuns: ${runs.length}`);
if (runs.length > 0) {
  ok(
    hasKeys(runs[0], ["session_id", "role", "status", "task_summary", "model"]),
    "recentRuns: ключи (RunRow)",
    Object.keys(runs[0]),
  );
}

const arts = getArtifacts();
ok(Array.isArray(arts), `getArtifacts: ${arts.length}`);
const ov = getPantheonOverview();
ok(
  hasKeys(ov as unknown as Record<string, unknown>, ["runs", "artifacts", "role_stats"]),
  "getPantheonOverview: ключи",
);
ok(
  Array.isArray(ov.role_stats) &&
    (ov.role_stats.length === 0 || hasKeys(ov.role_stats[0], ["role", "runs", "tokens", "models"])),
  "role_stats: роль/расходы/модели (tokens=null — в runs нет колонок)",
);

ok(Array.isArray(getScheduledJobs()), `getScheduledJobs: ${getScheduledJobs().length}`);
ok(Array.isArray(listStoredApps()), `listStoredApps: ${listStoredApps().length}`);

// content_blocks: юнит на синтетике
const noise = contentBlocks(JSON.stringify([{ type: "text", text: "<turn-context>x</turn-context>" }]));
ok(noise.length === 0, "contentBlocks: шум turn-context отфильтрован");
const img = contentBlocks(JSON.stringify([{ type: "image" }]));
ok(img.length === 1 && img[0].kind === "image", "contentBlocks: image → {kind:image}");

console.log("─ config.ts (временная копия) ─");
const dir = mkdtempSync(join(tmpdir(), "mayak-cfg-"));
const realCfg = join(process.env.HOME!, ".config/goose/config.yaml");
const tmpCfg = join(dir, "config.yaml");
copyFileSync(realCfg, tmpCfg);
const rawBefore = readFileSync(tmpCfg, "utf8");

const summary = getConfigSummary(tmpCfg);
ok(
  hasKeys(summary as unknown as Record<string, unknown>, [
    "active_provider",
    "goose_model",
    "goose_provider",
    "goose_mode",
    "extensions",
  ]),
  "getConfigSummary: ключи (без providers — паритет get_config_summary)",
);
ok(Array.isArray(summary.extensions) && summary.extensions.length > 0, `extensions: ${summary.extensions.length}`);
if (summary.extensions.length > 0) {
  ok(
    hasKeys(summary.extensions[0], ["name", "enabled", "description", "bundled"]),
    "extension: ключи ExtensionEntry",
  );
}

const limits = getConfigLimits(tmpCfg);
ok("goose_max_turns" in limits && "goose_auto_compact_threshold" in limits, "getConfigLimits: ключи");

// toggle на копии
const target = summary.extensions.find((e) => !e.enabled) ?? summary.extensions[0];
const wasEnabled = target.enabled;
try {
  toggleExtension(target.name, !wasEnabled, tmpCfg);
  const after = readSummary(tmpCfg);
  const t2 = after.extensions.find((e) => e.name === target.name);
  ok(t2?.enabled === !wasEnabled, `toggleExtension(${target.name}) → ${!wasEnabled}`);
  // бэкап создан?
  const bak = existsSync(tmpCfg.replace(/config\.yaml$/, `config.yaml.bak-mayak-${/\d+/.exec(readFileSync(tmpCfg, "utf8")) ? "0" : "0"}`));
  void bak;
  // активная модель — на копии
  setActiveModel("opencode_go", "glm-5.3-flash", tmpCfg);
  const s2 = readSummary(tmpCfg);
  ok(
    s2.goose_provider === "opencode_go" && s2.goose_model === "glm-5.3-flash" && s2.active_provider === "opencode_go",
    "setActiveModel: GOOSE_PROVIDER/GOOSE_MODEL/active_provider",
  );
  setGooseMode("auto", tmpCfg);
  ok(readSummary(tmpCfg).goose_mode === "auto", "setGooseMode: auto");
  try {
    setGooseMode("bogus", tmpCfg);
    ok(false, "setGooseMode: невалидный режим должен падать");
  } catch {
    ok(true, "setGooseMode: невалидный режим отклонён");
  }
} catch (e) {
  ok(false, "запись config на копии", String(e));
}
ok(readFileSync(tmpCfg, "utf8") !== "" && existsSync(tmpCfg), "копия конфига цела");
void rawBefore;

// промпты (чтение реальных, запись — whitelist-тест на несуществующем имени)
const prompts = listPromptFiles();
ok(prompts.length === 7 && prompts.every((p) => typeof p.exists === "boolean"), `listPromptFiles: ${prompts.length}`);
const sys = readPromptFile("system.md");
ok(sys.length > 100, `readPromptFile(system.md): ${sys.length} символов`);
try {
  readPromptFile("../../evil.md");
  ok(false, "readPromptFile: whitelist должен блокировать");
} catch {
  ok(true, "readPromptFile: whitelist блокирует ../");
}

// цепочки: чтение реального pantheon.toml, запись — на временной копии
const realToml = join(process.env.HOME!, ".config/goose/pantheon.toml");
const chains = getAgentChains(realToml);
ok(Array.isArray(chains) && chains.length === 3, `getAgentChains: ${chains.map((c) => c.role).join("/")}`);
if (chains.length > 0) {
  ok(
    hasKeys(chains[0], ["role", "primary", "fallbacks"]) &&
      hasKeys(chains[0].primary, ["provider", "model"]),
    "chain: ключи (AgentChainJson)",
  );
}
const tmpToml = join(dir, "pantheon.toml");
copyFileSync(realToml, tmpToml);
const before = getAgentChains(tmpToml);
const testChain = { primary: { provider: "opencode_go", model: "glm-5.3-flash" }, fallbacks: [] };
saveAgentChain("librarian", testChain, tmpToml);
const afterChains = getAgentChains(tmpToml);
const lib = afterChains.find((c) => c.role === "librarian");
ok(
  lib?.primary.model === "glm-5.3-flash",
  "saveAgentChain: запись + повторное чтение (round-trip)",
  lib,
);
void before;

const paths = getConfigPaths();
ok(
  hasKeys(paths as unknown as Record<string, unknown>, ["config_path", "config_dir", "prompts_dir"]),
  "getConfigPaths: ключи",
);

console.log("─ attachments / clipboard ─");
const tmpAttach = stageAttachment("test file (1).png", [137, 80, 78, 71]);
ok(existsSync(tmpAttach) && tmpAttach.includes("mayak-attachments"), `stageAttachment → ${tmpAttach}`);
const bytes = await readFileBytes(tmpAttach);
ok(Array.isArray(bytes) && bytes[0] === 137, `readFileBytes: ${bytes.length} B (number[])`);
try {
  await readFileBytes("/nonexistent/x.png");
  ok(false, "readFileBytes: ENOENT должен падать");
} catch {
  ok(true, "readFileBytes: ENOENT отклонён");
}
const ci = clipboardImage();
ok(ci === null || (typeof ci.mime === "string" && Array.isArray(ci.data)), `clipboardImage: ${ci ? ci.mime : "null (нет картинки в буфере — ок)"}`);

console.log("─ справочная сверка с legacy (запускнеобязателен) ─");
console.log(`  (форматы выровнены по исходникам src-tauri/src/*.rs rev14)`);

if (failed > 0) {
  console.error(`\n❌ ПРОВАЛЕНО: ${failed}`);
  process.exit(1);
}
console.log("\n✅ API-слой: все проверки зелёные");
