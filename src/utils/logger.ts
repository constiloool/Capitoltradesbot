type LogValue = string | number | boolean | undefined;

function write(level: string, scope: string, message: string, meta?: Record<string, LogValue>) {
  const suffix = meta
    ? ` ${Object.entries(meta)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")}`
    : "";
  console.log(`${new Date().toISOString()} [${level}] [${scope}] ${message}${suffix}`);
}

export const logger = {
  info: (scope: string, message: string, meta?: Record<string, LogValue>) =>
    write("INFO", scope, message, meta),
  warn: (scope: string, message: string, meta?: Record<string, LogValue>) =>
    write("WARN", scope, message, meta),
  error: (scope: string, message: string, error?: unknown) =>
    write("ERROR", scope, message, {
      error: error instanceof Error ? error.message : String(error ?? ""),
    }),
};
