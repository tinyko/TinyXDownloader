export interface RestoreDatabaseBackupResult {
  success: boolean;
  requires_restart: boolean;
  message: string;
}

type DiagnosticsAppBridge = {
  CreateDatabaseBackup?: () => Promise<string> | string;
  ExportSupportBundle?: () => Promise<string> | string;
  OpenAppDataFolder?: () => Promise<void> | void;
  RestoreDatabaseBackup?: () => Promise<RestoreDatabaseBackupResult> | RestoreDatabaseBackupResult;
  WriteSettingsSnapshot?: (rawSettings: string) => Promise<void> | void;
};

function getDiagnosticsBridge(): DiagnosticsAppBridge | null {
  const browserWindow = window as typeof window & {
    go?: {
      main?: {
        App?: DiagnosticsAppBridge;
      };
    };
  };

  return browserWindow.go?.main?.App || null;
}

export function createDatabaseBackup() {
  const bridge = getDiagnosticsBridge();
  if (!bridge?.CreateDatabaseBackup) {
    return Promise.reject(new Error("Database backup is not available in this environment"));
  }
  return Promise.resolve(bridge.CreateDatabaseBackup());
}

export function exportSupportBundle() {
  const bridge = getDiagnosticsBridge();
  if (!bridge?.ExportSupportBundle) {
    return Promise.reject(new Error("Support bundle export is not available in this environment"));
  }
  return Promise.resolve(bridge.ExportSupportBundle());
}

export function openAppDataFolder() {
  const bridge = getDiagnosticsBridge();
  if (!bridge?.OpenAppDataFolder) {
    return Promise.reject(new Error("App data folder is not available in this environment"));
  }
  return Promise.resolve(bridge.OpenAppDataFolder());
}

export function restoreDatabaseBackup() {
  const bridge = getDiagnosticsBridge();
  if (!bridge?.RestoreDatabaseBackup) {
    return Promise.reject(new Error("Database restore is not available in this environment"));
  }
  return Promise.resolve(bridge.RestoreDatabaseBackup()) as Promise<RestoreDatabaseBackupResult>;
}

export function persistSettingsSnapshot(rawSettings: string) {
  const bridge = getDiagnosticsBridge();
  if (!bridge?.WriteSettingsSnapshot) {
    return Promise.resolve();
  }
  return Promise.resolve(bridge.WriteSettingsSnapshot(rawSettings));
}
