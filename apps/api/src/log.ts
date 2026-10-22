// One JSON line per event on stderr. Never log tokens or request bodies.
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

function write(level: string, msg: string, fields?: Record<string, unknown>): void {
  console.error(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }));
}

export const jsonLogger: Logger = {
  info: (m, f) => write("info", m, f),
  warn: (m, f) => write("warn", m, f),
  error: (m, f) => write("error", m, f),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** Collects log lines, for tests. */
export function memoryLogger(): Logger & { lines: { level: string; msg: string; fields?: Record<string, unknown> }[] } {
  const lines: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];
  return {
    lines,
    info: (msg, fields) => lines.push({ level: "info", msg, fields }),
    warn: (msg, fields) => lines.push({ level: "warn", msg, fields }),
    error: (msg, fields) => lines.push({ level: "error", msg, fields }),
  };
}
