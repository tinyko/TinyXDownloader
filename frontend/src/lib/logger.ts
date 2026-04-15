export type LogLevel = "info" | "success" | "warning" | "error" | "debug";

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
}

type BrowserWindowWithWails = Window & {
  go?: {
    main?: {
      App?: {
        WriteDiagnosticLog?: (level: LogLevel, message: string) => Promise<void> | void;
      };
    };
  };
};

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 500;
  private listeners: Set<() => void> = new Set();

  private persistLog(entry: LogEntry) {
    if (typeof window === "undefined") {
      return;
    }

    const browserWindow = window as BrowserWindowWithWails;
    const writeLog = browserWindow.go?.main?.App?.WriteDiagnosticLog;
    if (!writeLog) {
      return;
    }

    Promise.resolve(writeLog(entry.level, entry.message)).catch((error: unknown) => {
      console.error("Failed to persist diagnostic log:", error);
    });
  }

  private addLog(level: LogLevel, message: string) {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message: message.toLowerCase(),
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    this.persistLog(entry);
    this.notifyListeners();
  }

  info(message: string) {
    this.addLog("info", message);
  }

  success(message: string) {
    this.addLog("success", message);
  }

  warning(message: string) {
    this.addLog("warning", message);
  }

  error(message: string) {
    this.addLog("error", message);
  }

  debug(message: string) {
    this.addLog("debug", message);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
    this.notifyListeners();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => listener());
  }
}

export const logger = new Logger();
