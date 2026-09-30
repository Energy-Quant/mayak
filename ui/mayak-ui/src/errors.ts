/**
 * errors.ts — структурированные ошибки Маяка (P3).
 *
 * Вместо throw new Error("что-то сломалось") — код + контекст + пользовательский текст.
 * Правила:
 *  - Каждый throw несёт code (машиночитаемо) + detail (для лога) + userMessage (для UI).
 *  - Граница UI ловит AppError → показывает userMessage, логирует detail с кодом.
 *  - Обычный Error тоже поддерживается через toAppError() на границах.
 */
import { log } from "./logger";

/** Коды ошибок — стабильные идентификаторы для обработки и поиска в логах. */
export const E = {
  // конфиг
  CONFIG_SECTION: "CONFIG_SECTION",
  CONFIG_EXT_MISSING: "CONFIG_EXT_MISSING",
  CONFIG_BAD_MODE: "CONFIG_BAD_MODE",
  CONFIG_BAD_NAME: "CONFIG_BAD_NAME",
  CONFIG_NOT_FOUND: "CONFIG_NOT_FOUND",
  CONFIG_WRITE: "CONFIG_WRITE",
  CONFIG_BAD_ROLE: "CONFIG_BAD_ROLE",
  // БД
  DB_OPEN: "DB_OPEN",
  DB_QUERY: "DB_QUERY",
  // каталог / ключи
  NO_API_KEY: "NO_API_KEY",
  CATALOG_READ: "CATALOG_READ",
  // goose serve
  GOOSE_BINARY: "GOOSE_BINARY",
  GOOSE_STARTUP: "GOOSE_STARTUP",
  GOOSE_STOP: "GOOSE_STOP",
  // ACP
  ACP_NO_SESSION: "ACP_NO_SESSION",
  ACP_DEAD: "ACP_DEAD",
  ACP_PROMPT: "ACP_PROMPT",
  ACP_LOAD: "ACP_LOAD",
  // вложения
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  FILE_TOO_BIG: "FILE_TOO_BIG",
  FILE_READ: "FILE_READ",
  // сеть / лимиты
  HTTP_ERROR: "HTTP_ERROR",
  NETWORK: "NETWORK",
  // UI
  UI_RENDER: "UI_RENDER",
  UI_UNKNOWN: "UI_UNKNOWN",
} as const;

export type ErrorCode = (typeof E)[keyof typeof E];

export class AppError extends Error {
  readonly code: ErrorCode | string;
  readonly detail: string;
  readonly userMessage: string;
  readonly context: Record<string, unknown>;
  readonly recoverable: boolean;

  constructor(
    code: ErrorCode | string,
    detail: string,
    opts?: { userMessage?: string; context?: Record<string, unknown>; recoverable?: boolean },
  ) {
    super(`[${code}] ${detail}`);
    this.name = "AppError";
    this.code = code;
    this.detail = detail;
    this.userMessage = opts?.userMessage ?? defaultUserMessage(code);
    this.context = opts?.context ?? {};
    this.recoverable = opts?.recoverable ?? false;
    // логируем в момент создания — точка отказа сразу в логе
    log.error(`err.${code}`, `${detail} ${JSON.stringify(this.context)}`);
  }
}

function defaultUserMessage(code: string): string {
  switch (code) {
    case E.CONFIG_NOT_FOUND:
    case E.CONFIG_SECTION:
    case E.CONFIG_EXT_MISSING:
      return "Проблема с конфигурацией. Проверьте настройки.";
    case E.CONFIG_BAD_MODE:
    case E.CONFIG_BAD_ROLE:
    case E.CONFIG_BAD_NAME:
      return "Недопустимое значение.";
    case E.NO_API_KEY:
      return "API-ключ не найден. Добавьте OPENCODE_API_KEY.";
    case E.GOOSE_BINARY:
      return "goose не найден. Установите goose или проверьте PATH.";
    case E.GOOSE_STARTUP:
      return "Сервер goose не запустился. Попробуйте ещё раз.";
    case E.ACP_NO_SESSION:
      return "Сессия не открыта. Откройте чат заново.";
    case E.ACP_DEAD:
      return "Сессия закрыта. Откройте чат заново.";
    case E.FILE_NOT_FOUND:
      return "Файл не найден.";
    case E.FILE_TOO_BIG:
      return "Файл слишком большой (макс. 25 МБ).";
    case E.HTTP_ERROR:
    case E.NETWORK:
      return "Сетевая ошибка. Проверьте подключение.";
    default:
      return "Произошла ошибка. Подробности в логе.";
  }
}

/** Привести любую ошибку к AppError (граница UI / catch). */
export function toAppError(e: unknown, fallbackCode: ErrorCode | string = E.UI_UNKNOWN): AppError {
  if (e instanceof AppError) return e;
  const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return new AppError(fallbackCode, detail, { context: { raw: detail } });
}

/** Обёртка try-catch с structured error. */
export async function tryOrAppError<T>(
  code: ErrorCode,
  fn: () => Promise<T>,
  context: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(code, e instanceof Error ? e.message : String(e), { context });
  }
}

/** Синхронная версия. */
export function tryOrAppErrorSync<T>(
  code: ErrorCode,
  fn: () => T,
  context: Record<string, unknown> = {},
): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(code, e instanceof Error ? e.message : String(e), { context });
  }
}
