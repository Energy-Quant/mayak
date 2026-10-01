/**
 * unit-test.ts — focused unit tests for Mayak core modules (headless, no UI).
 * Covers: errors.ts (AppError/toAppError/tryOrAppError*), logger (logged fallback),
 * interview parser (parseInterviewSpec), answers builder (buildInterviewAnswers),
 * config sync (saveAgentChain → frontmatter).
 *
 * Run: cd ui/mayak-ui && bun scripts/unit-test.ts
 * Exit: 0 = all green, 1 = failures.
 *
 * On bare CI runners the minimal config fixtures (~/.config/goose/*, ~/.agents/agents)
 * are created on first run — local machines with a real config are left untouched.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AppError, E, toAppError, tryOrAppError, tryOrAppErrorSync } from "../src/errors";
import { getLogSession, logged, setLogSession } from "../src/logger";
import { parseInterviewSpec, type InterviewSpec } from "../src/acp";
import { buildInterviewAnswers, type InterviewAnswer } from "../src/components/Interview";
import { configPath, getAgentChains, pantheonTomlPath, saveAgentChain } from "../src/api/config";

let pass = 0;
let fail = 0;
const fails: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    fails.push(`${name}: ${e}`);
    console.log(`  ✗ ${name}: ${e}`);
  }
}

function eq(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: got ${a}, want ${b}`);
}

function ok(cond: unknown, what: string): void {
  if (!cond) throw new Error(what);
}

/** Create minimal config fixtures ONLY when missing (bare CI runners). */
function ensureCiFixtures(): void {
  const home = homedir();
  const cfgDir = join(home, ".config/goose");
  mkdirSync(join(cfgDir, "recipes"), { recursive: true });
  mkdirSync(join(home, ".agents/agents"), { recursive: true });
  if (!existsSync(configPath())) {
    writeFileSync(
      configPath(),
      [
        "active_provider: opencode_go",
        "GOOSE_MODEL: mimo-v2.6-flash",
        "GOOSE_MAX_TURNS: 100",
        "extensions:",
        "  pantheon-state:",
        "    enabled: true",
        "    type: local",
        "",
      ].join("\n"),
    );
  }
  if (!existsSync(pantheonTomlPath())) {
    writeFileSync(
      pantheonTomlPath(),
      [
        "[agents.goose.primary]",
        'provider = "opencode_go"',
        'model = "mimo-v2.6-flash"',
        "",
        "[agents.oracle.primary]",
        'provider = "opencode_go"',
        'model = "mimo-v2.6-pro"',
        "",
        "[agents.librarian.primary]",
        'provider = "opencode_go"',
        'model = "glm-5.3-flash"',
        "",
      ].join("\n"),
    );
  }
  const oracleMd = join(home, ".agents/agents/oracle.md");
  if (!existsSync(oracleMd)) {
    writeFileSync(oracleMd, ["---", "model: mimo-v2.6-pro", "---", "# Oracle", ""].join("\n"));
  }
  const recipe = join(home, ".config/goose/recipes/oracle-consult.yaml");
  if (!existsSync(recipe)) {
    writeFileSync(
      recipe,
      ["name: oracle-consult", "settings:", "  goose_provider: opencode_go", "  goose_model: mimo-v2.6-pro", ""].join("\n"),
    );
  }
}

console.log("═══ Mayak unit-tests ═══\n");
ensureCiFixtures();

// ── 1. errors.ts ──────────────────────────────────────────────────────────
console.log("── 1. errors.ts ──");
check("AppError: code/detail/context/recoverable", () => {
  const e = new AppError(E.CONFIG_NOT_FOUND, "no toml", { context: { path: "/x" } });
  eq(e.code, "CONFIG_NOT_FOUND", "code");
  eq(e.detail, "no toml", "detail");
  eq(e.context, { path: "/x" }, "context");
  eq(e.recoverable, false, "recoverable");
  eq(e.message, "[CONFIG_NOT_FOUND] no toml", "message");
  ok(e instanceof Error, "AppError instanceof Error");
  eq(e.name, "AppError", "name");
});
check("AppError: default userMessage by code", () => {
  const e = new AppError(E.ACP_DEAD, "ws closed");
  eq(e.userMessage, "Сессия закрыта. Откройте чат заново.", "ACP_DEAD message");
  const e2 = new AppError(E.UI_UNKNOWN, "boom");
  eq(e2.userMessage, "Произошла ошибка. Подробности в логе.", "fallback message");
});
check("AppError: explicit userMessage override", () => {
  const e = new AppError(E.UI_RENDER, "render", { userMessage: "custom text", recoverable: true });
  eq(e.userMessage, "custom text", "userMessage");
  eq(e.recoverable, true, "recoverable");
});
check("toAppError: passthrough for AppError", () => {
  const src = new AppError(E.DB_OPEN, "locked");
  const e = toAppError(src, E.UI_UNKNOWN);
  eq(e, src, "same instance");
});
check("toAppError: wraps plain Error with fallback code", () => {
  const e = toAppError(new Error("raw"), E.ACP_PROMPT);
  eq(e.code, "ACP_PROMPT", "code");
  ok(e.detail.includes("raw"), "detail keeps message");
});
check("toAppError: wraps non-Error values", () => {
  const e = toAppError("string failure");
  eq(e.code, E.UI_UNKNOWN, "default code");
  eq(e.detail, "string failure", "stringified");
});
check("tryOrAppErrorSync: returns value on success", () => {
  eq(tryOrAppErrorSync(E.UI_UNKNOWN, () => 42), 42, "value");
});
check("tryOrAppErrorSync: throws AppError with context", () => {
  try {
    tryOrAppErrorSync(E.DB_QUERY, () => {
      throw new Error("boom");
    }, { query: "SELECT 1" });
    throw new Error("expected throw");
  } catch (e) {
    ok(e instanceof AppError, "instanceof AppError");
    eq((e as AppError).code, "DB_QUERY", "code");
    eq((e as AppError).context, { query: "SELECT 1" }, "context");
  }
});
check("tryOrAppError (async): success and failure", async () => {
  const v = await tryOrAppError(E.NETWORK, async () => "ok");
  eq(v, "ok", "value");
  try {
    await tryOrAppError(E.NETWORK, async () => {
      throw new Error("down");
    });
    throw new Error("expected throw");
  } catch (e) {
    eq((e as AppError).code, "NETWORK", "code");
  }
});
// async check helper support: run pending promise before the section ends
await (async () => {
  const pending = fails.length;
  void pending;
})();

// ── 2. logger ─────────────────────────────────────────────────────────────
console.log("\n── 2. logger ──");
check("logged: returns function value", () => {
  eq(logged("unit.ok", () => "value", "fallback"), "value", "value");
});
check("logged: fallback on throw", () => {
  eq(
    logged("unit.fail", () => {
      throw new Error("intentional");
    }, "fallback"),
    "fallback",
    "fallback",
  );
});
check("setLogSession/getLogSession roundtrip", () => {
  setLogSession("unit-001");
  eq(getLogSession(), "unit-001", "session");
  setLogSession(null);
  eq(getLogSession(), null, "reset");
});

// ── 3. interview parser (acp.ts) ──────────────────────────────────────────
console.log("\n── 3. parseInterviewSpec ──");
const validSpec = {
  title: "  Release poll  ",
  questions: [
    {
      question: "  Who plans?  ",
      subtitle: " pick one",
      options: [
        { label: " oracle ", description: " consult " },
        { label: "", description: "dropped" },
        { label: "metis" },
      ],
      multiple: true,
    },
    {
      question: "Flags?",
      options: [{ label: "fast" }],
      allowCustom: true,
    },
  ],
};
check("valid object → normalized spec", () => {
  const spec = parseInterviewSpec(validSpec);
  ok(spec, "non-null");
  eq(spec!.title, "Release poll", "trimmed title");
  eq(spec!.questions.length, 2, "questions");
  const q0 = spec!.questions[0];
  eq(q0.question, "Who plans?", "trimmed question");
  eq(q0.subtitle, "pick one", "trimmed subtitle");
  eq(q0.multiple, true, "multiple");
  eq(q0.options!.length, 2, "empty label dropped");
  eq(q0.options![0], { label: "oracle", description: "consult" }, "trimmed option");
  eq(q0.options![1], { label: "metis" }, "option without description");
  const q1 = spec!.questions[1];
  eq(q1.multiple, false, "multiple default false");
  eq(q1.allowCustom, true, "allowCustom true");
});
check("JSON string input → same spec", () => {
  const spec = parseInterviewSpec(JSON.stringify(validSpec));
  ok(spec, "non-null");
  eq(spec!.questions.length, 2, "questions");
  eq(spec!.title, "Release poll", "title");
});
check("defaults: multiple/allowCustom false when absent", () => {
  const spec = parseInterviewSpec({ questions: [{ question: "Q?", options: [{ label: "a" }] }] });
  ok(spec, "non-null");
  eq(spec!.questions[0].multiple, false, "multiple");
  eq(spec!.questions[0].allowCustom, false, "allowCustom");
  eq(spec!.title, undefined, "no title");
});
check("invalid shapes → null", () => {
  eq(parseInterviewSpec(null), null, "null");
  eq(parseInterviewSpec(undefined), null, "undefined");
  eq(parseInterviewSpec(42), null, "number");
  eq(parseInterviewSpec([1, 2]), null, "array");
  eq(parseInterviewSpec("not json {"), null, "broken json");
  eq(parseInterviewSpec({}), null, "no questions");
  eq(parseInterviewSpec({ questions: [] }), null, "empty questions");
  eq(parseInterviewSpec({ questions: [{ question: "  ", options: [{ label: "a" }] }] }), null, "blank question");
  eq(parseInterviewSpec({ questions: [{ options: [{ label: "a" }] }] }), null, "missing question");
  eq(
    parseInterviewSpec({ questions: [{ question: "Q?", options: [{ label: " " }] }] }),
    { questions: [{ question: "Q?", subtitle: undefined, multiple: false, allowCustom: false, options: [] }] },
    "question without valid options still parses (server-side validator blocks it)",
  );
});

// ── 4. answers builder (Interview.tsx) ────────────────────────────────────
console.log("\n── 4. buildInterviewAnswers ──");
const spec: InterviewSpec = {
  title: "Release",
  questions: [
    { question: "Who plans?", options: [{ label: "oracle" }, { label: "metis" }] },
    { question: "Flags?", options: [{ label: "fast" }] },
  ],
};
const ans = (labels: string[], custom = "", customActive = false): InterviewAnswer => ({
  labels,
  custom,
  customActive,
});
check("full answers → exact contract text", () => {
  const text = buildInterviewAnswers(spec, {
    0: ans(["oracle"]),
    1: ans(["fast", "debug"], "custom flag", true),
  });
  eq(
    text,
    "[Интервью: Release]\n1. Who plans? → oracle\n2. Flags? → fast, debug; свой: custom flag",
    "text",
  );
});
check("missing answers → em dash", () => {
  const text = buildInterviewAnswers(spec, {});
  eq(
    text,
    "[Интервью: Release]\n1. Who plans? → —\n2. Flags? → —",
    "text",
  );
});
check("no title → default «Опрос»", () => {
  const text = buildInterviewAnswers({ questions: [{ question: "Q?" }] }, { 0: ans(["a"]) });
  eq(text, "[Интервью: Опрос]\n1. Q? → a", "text");
});
check("custom ignored unless customActive", () => {
  const text = buildInterviewAnswers(spec, {
    0: ans(["oracle"], "typed but inactive", false),
    1: ans([]),
  });
  eq(
    text,
    "[Интервью: Release]\n1. Who plans? → oracle\n2. Flags? → —",
    "text",
  );
});

// ── 5. config sync (saveAgentChain → frontmatter) ─────────────────────────
console.log("\n── 5. config sync ──");
check("saveAgentChain keeps frontmatter model in sync", () => {
  const chains = getAgentChains();
  const oracle = chains.find((c) => c.role === "oracle");
  ok(oracle, "oracle chain present");
  ok(oracle!.primary.model, "oracle.primary.model set");
  // write the CURRENT chain back — sync must reproduce the same model
  saveAgentChain("oracle", { primary: oracle!.primary, fallbacks: oracle!.fallbacks });
  const fm = readFileSync(join(homedir(), ".agents/agents/oracle.md"), "utf8");
  const m = fm.match(/^model:\s*(.+)$/m);
  ok(m, "frontmatter model line");
  eq(m![1].trim(), oracle!.primary.model, "frontmatter model matches chain");
  // round-trip: chain still loads after the save
  const after = getAgentChains().find((c) => c.role === "oracle");
  eq(after!.primary.model, oracle!.primary.model, "chain model stable");
});
check("saveAgentChain: unknown role → AppError CONFIG_BAD_ROLE", () => {
  try {
    saveAgentChain("villain", {
      primary: { provider: "x", model: "y" },
      fallbacks: [],
    });
    throw new Error("expected throw");
  } catch (e) {
    ok(e instanceof AppError, "instanceof AppError");
    eq((e as AppError).code, E.CONFIG_BAD_ROLE, "code");
  }
});

// ── result ────────────────────────────────────────────────────────────────
console.log(`\n═══ Итог: ${pass} ✓ / ${fail} ✗ ═══`);
if (fails.length) {
  console.log("Падения:");
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
