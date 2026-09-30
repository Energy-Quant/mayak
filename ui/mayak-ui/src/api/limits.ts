/**
 * api/limits.ts — порт limits.rs: лимиты OpenCode Go (5ч/нед/мес).
 * GET https://opencode.ai/zen/go/v1/usage — UA + x-opencode-session обязательны.
 */
import { opencodeApiKey } from "./catalog";
import { AppError, E } from "../errors";

export interface UsageWindow {
  status: string;
  percent: number;
  resetsAt: string | null;
}
export interface UsageReport {
  rolling: UsageWindow;
  weekly: UsageWindow;
  monthly: UsageWindow;
}

const emptyWindow = (): UsageWindow => ({ status: "unknown", percent: 0, resetsAt: null });

export async function getOpencodeUsage(): Promise<UsageReport> {
  const key = opencodeApiKey();
  if (!key) {
    throw new AppError(E.NO_API_KEY, "OPENCODE_API_KEY не найден (env/secrets)");
  }
  const res = await fetch("https://opencode.ai/zen/go/v1/usage", {
    headers: {
      Authorization: `Bearer ${key}`,
      "User-Agent": "goose/1.51.0",
      "x-opencode-session": "mayak-ui-limits",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new AppError(E.HTTP_ERROR, `usage request: HTTP ${res.status}`, { context: { status: res.status } });
  const v = (await res.json()) as { usage?: Record<string, unknown> };
  const u = v.usage ?? {};

  const win = (k: string): UsageWindow => {
    const w = u[k] as Record<string, unknown> | undefined;
    if (!w) return emptyWindow();
    return {
      status: typeof w.status === "string" ? w.status : "ok",
      percent: Math.min(100, typeof w.percent === "number" ? w.percent : 0),
      resetsAt: typeof w.resetsAt === "string" ? w.resetsAt : null,
    };
  };

  return { rolling: win("rolling"), weekly: win("weekly"), monthly: win("monthly") };
}
