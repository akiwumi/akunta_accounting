/**
 * Structured logger for Akunta.
 *
 * Outputs JSON lines in production (machine-readable for log aggregators).
 * Outputs pretty-printed lines in development.
 *
 * Usage:
 *   import { logger } from "@/lib/observability/logger";
 *   logger.info("receipt.uploaded", { businessId, receiptId });
 *   logger.error("stripe.webhook.failed", { error: err.message });
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogEntry = {
  ts: string;
  level: LogLevel;
  event: string;
  [key: string]: unknown;
};

const isDev = process.env.NODE_ENV !== "production";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? (isDev ? "debug" : "info");

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

function write(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields
  };

  if (isDev) {
    const prefix = { debug: "🔍", info: "ℹ️ ", warn: "⚠️ ", error: "❌" }[level];
    const extra = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
    console.log(`${prefix} [${entry.ts}] ${event}${extra}`);
  } else {
    // JSON line — one log entry per line for aggregators (Datadog, Loki, CloudWatch)
    process.stdout.write(JSON.stringify(entry) + "\n");
  }
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => write("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields)
};

/**
 * Wrap an async route handler and log unhandled errors before rethrowing.
 * Useful for API routes you want to instrument without adding try/catch everywhere.
 */
export function withLogging<T extends unknown[], R>(
  event: string,
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (err) {
      logger.error(`${event}.unhandled_error`, {
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  };
}
