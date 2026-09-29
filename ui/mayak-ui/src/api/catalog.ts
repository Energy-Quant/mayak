/**
 * api/catalog.ts — порт get_provider_catalog / validate_chain_step из main.rs.
 * context_limit: file-is-truth ~/.config/goose/opencode-go-models.json (MERGE поверх API).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { spawnSync } from "node:child_process";
import { log } from "../logger";
import type { ChainStep } from "./config";

export interface CatalogModel {
  name: string;
  context_limit: number | null;
}
export interface Catalog {
  providers: string[];
  models_by_provider: Record<string, CatalogModel[]>;
}

/** Локальная истина context_limit: opencode-go-models.json (AA-ревизия) */
function loadContextTruth(): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const raw = readFileSync(join(homedir(), ".config/goose/opencode-go-models.json"), "utf8");
    const v = JSON.parse(raw) as { models?: Record<string, unknown>[] };
    for (const m of v.models ?? []) {
      const id = typeof m.id === "string" ? m.id : null;
      if (!id) continue;
      const ctx = m.context_limit ?? m.context;
      if (typeof ctx === "number") out.set(id, ctx);
    }
  } catch (e) {
    log.debug("catalog.loadContextTruth", e instanceof Error ? e.message : String(e));
  }
  return out;
}

/** OPENCODE_API_KEY: env → secrets.yaml → keyring secret-tool (service=goose) */
export function opencodeApiKey(): string | null {
  const env = process.env.OPENCODE_API_KEY?.trim();
  if (env) return env;
  try {
    const text = readFileSync(join(homedir(), ".config/goose/secrets.yaml"), "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t.startsWith("#")) continue;
      if (t.startsWith("OPENCODE_API_KEY")) {
        const v = t
          .slice("OPENCODE_API_KEY".length)
          .replace(/^[:\s"' ]+/, "")
          .replace(/['"]+$/g, "")
          .trim();
        if (v) return v;
      }
    }
  } catch (e) {
    log.debug("catalog.secrets.yaml", e instanceof Error ? e.message : String(e));
  }
  try {
    const o = spawnSync("secret-tool", ["search", "--all", "service", "goose"], { encoding: "utf8" });
    if (o.stdout) {
      const line = o.stdout.split("\n").find((l) => l.startsWith("secret = "));
      if (line) {
        const j = JSON.parse(line.slice("secret = ".length)) as Record<string, unknown>;
        if (typeof j.OPENCODE_API_KEY === "string" && j.OPENCODE_API_KEY) return j.OPENCODE_API_KEY;
      }
    }
  } catch (e) {
    log.debug("catalog.secrets.keyring", e instanceof Error ? e.message : String(e));
  }
  return null;
}

export async function getProviderCatalog(): Promise<Catalog> {
  const raw = readFileSync(join(homedir(), ".config/goose/config.yaml"), "utf8");
  const val = parseYaml(raw) as Record<string, unknown>;
  const ext = (val.extensions ?? {}) as Record<string, Record<string, unknown>>;
  const providers = Object.entries(ext)
    .filter(([, e]) => e?.enabled === true)
    .map(([k]) => k)
    .sort();

  const ctxTruth = loadContextTruth();
  let apiList: CatalogModel[] = [];

  const key = opencodeApiKey();
  if (key) {
    try {
      const res = await fetch("https://opencode.ai/zen/go/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await res.json()) as { data?: Record<string, unknown>[] };
      apiList = (j.data ?? [])
        .filter((m) => typeof m.id === "string")
        .map((m) => ({
          name: m.id as string,
          context_limit: typeof m.context_limit === "number" ? (m.context_limit as number) : null,
        }));
    } catch {
      /* API упал — catalog из JSON */
    }
  }

  // MERGE: context_limit из JSON перекрывает API; если API пуст — весь каталог из JSON
  if (apiList.length === 0) {
    apiList = [...ctxTruth.keys()]
      .sort()
      .map((name) => ({ name, context_limit: ctxTruth.get(name) ?? null }));
  } else {
    for (const m of apiList) {
      const c = ctxTruth.get(m.name);
      if (c !== undefined) m.context_limit = c;
    }
  }

  return { providers, models_by_provider: { opencode_go: apiList } };
}

export interface ValidationResult {
  ok: boolean;
  status: number | null;
  error: string | null;
  latency_ms: number;
}

/** Мини-запрос к модели (ловит 403/region/невалидные имена) — паритет main.rs */
export async function validateChainStep(step: ChainStep): Promise<ValidationResult> {
  const started = Date.now();
  const key = opencodeApiKey();
  if (!key) throw new Error("OPENCODE_API_KEY не найден (env/secrets/keyring)");

  let status: number | null = null;
  try {
    const res = await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "User-Agent": "goose/1.51.0",
        "x-opencode-session": "mayak-ui-validate",
      },
      body: JSON.stringify({
        model: step.model,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 8,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
    await res.text();
  } catch (e) {
    return {
      ok: false,
      status: null,
      error: String(e),
      latency_ms: Date.now() - started,
    };
  }
  const ok = status === 200;
  return {
    ok,
    status,
    error: ok
      ? null
      : status === 403
        ? "403: модель недоступна (mimo-ловушка)"
        : status === 400
          ? "400: region/параметры — проверить Privacy=Global"
          : `HTTP ${status}`,
    latency_ms: Date.now() - started,
  };
}
