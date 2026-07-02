const RESERVED_KEYS = new Set(["ts", "level", "requestId", "stage", "msg"]);

export type LogLevel = "info" | "warn" | "error";

export type Logger = {
  info(stage: string, msg: string, extra?: Record<string, unknown>): void;
  warn(stage: string, msg: string, extra?: Record<string, unknown>): void;
  error(stage: string, msg: string, extra?: Record<string, unknown>): void;
};

function emit(
  level: LogLevel,
  requestId: string,
  stage: string,
  msg: string,
  extra: Record<string, unknown> | undefined,
): void {
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    requestId,
    stage,
    msg,
  };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (RESERVED_KEYS.has(k)) continue;
      line[k] = v;
    }
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(line);
  } catch {
    const fallback = {
      ts: line.ts,
      level,
      requestId,
      stage,
      msg,
      loggingError: "stringify_failed",
    };
    serialized = JSON.stringify(fallback);
  }
  if (level === "error") {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}

export function createLogger(opts: { requestId: string }): Logger {
  const { requestId } = opts;
  const safe =
    (level: LogLevel) =>
    (stage: string, msg: string, extra?: Record<string, unknown>) => {
      try {
        emit(level, requestId, stage, msg, extra);
      } catch {
        // never throw
      }
    };
  return {
    info: safe("info"),
    warn: safe("warn"),
    error: safe("error"),
  };
}

export const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
