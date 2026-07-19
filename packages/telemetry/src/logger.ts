export interface LogContext {
  attempt?: number;
  correlationId?: string;
  durationMs?: number;
  releaseId?: string;
  status?: string;
  testRunId?: string;
  [key: string]: unknown;
}

export interface LogEntry extends LogContext {
  level: "info";
  message: string;
  timestamp: string;
}

export type LogWriter = (entry: LogEntry) => void;

export interface ReleaseMeshLogger {
  info(message: string, context?: LogContext): void;
}

export function createLogger(write: LogWriter = writeToConsole): ReleaseMeshLogger {
  return {
    info(message, context = {}) {
      write({
        ...context,
        level: "info",
        message,
        timestamp: new Date().toISOString()
      });
    }
  };
}

function writeToConsole(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}
