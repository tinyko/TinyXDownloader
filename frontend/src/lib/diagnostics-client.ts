import type {
  DateRangeParityRequest,
  ExtractorDiagnosticsSnapshot,
  ExtractorLiveValidationReport,
  ExtractorParityReport,
  ExtractorRolloutPolicy,
  ExtractorRunbookConfig,
  ExtractorValidationReport,
  ExtractorValidationRunRequest,
  TimelineParityRequest,
} from "@/types/diagnostics";

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
  GetExtractorDiagnosticsSnapshot?: () => Promise<ExtractorDiagnosticsSnapshot> | ExtractorDiagnosticsSnapshot;
  CompareTimelineExtractorParity?: (req: TimelineParityRequest) => Promise<ExtractorParityReport> | ExtractorParityReport;
  CompareDateRangeExtractorParity?: (req: DateRangeParityRequest) => Promise<ExtractorParityReport> | ExtractorParityReport;
  SaveExtractorRunbookConfig?: (config: ExtractorRunbookConfig) => Promise<ExtractorRunbookConfig> | ExtractorRunbookConfig;
  SaveExtractorRolloutPolicy?: (policy: ExtractorRolloutPolicy) => Promise<ExtractorRolloutPolicy> | ExtractorRolloutPolicy;
  RunExtractorValidationRunbook?: (
    req: ExtractorValidationRunRequest
  ) => Promise<ExtractorValidationReport> | ExtractorValidationReport;
  RunExtractorLiveValidationSession?: (
    req: ExtractorValidationRunRequest
  ) => Promise<ExtractorLiveValidationReport> | ExtractorLiveValidationReport;
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

export function getExtractorDiagnosticsSnapshot() {
  const bridge = getDiagnosticsBridge();
  if (!bridge?.GetExtractorDiagnosticsSnapshot) {
    return Promise.reject(new Error("Extractor diagnostics are not available in this environment"));
  }
  return Promise.resolve(bridge.GetExtractorDiagnosticsSnapshot()) as Promise<ExtractorDiagnosticsSnapshot>;
}

export function compareTimelineExtractorParity(req: TimelineParityRequest) {
  const bridge = getDiagnosticsBridge();
  if (!bridge?.CompareTimelineExtractorParity) {
    return Promise.reject(new Error("Timeline parity is not available in this environment"));
  }
  return Promise.resolve(bridge.CompareTimelineExtractorParity(req)) as Promise<ExtractorParityReport>;
}

export function compareDateRangeExtractorParity(req: DateRangeParityRequest) {
  const bridge = getDiagnosticsBridge();
  if (!bridge?.CompareDateRangeExtractorParity) {
    return Promise.reject(new Error("Date-range parity is not available in this environment"));
  }
  return Promise.resolve(bridge.CompareDateRangeExtractorParity(req)) as Promise<ExtractorParityReport>;
}

export function saveExtractorRunbookConfig(config: ExtractorRunbookConfig) {
  const bridge = getDiagnosticsBridge();
  if (!bridge?.SaveExtractorRunbookConfig) {
    return Promise.reject(new Error("Extractor runbook config is not available in this environment"));
  }
  return Promise.resolve(bridge.SaveExtractorRunbookConfig(config)) as Promise<ExtractorRunbookConfig>;
}

export function saveExtractorRolloutPolicy(policy: ExtractorRolloutPolicy) {
  const bridge = getDiagnosticsBridge();
  if (!bridge?.SaveExtractorRolloutPolicy) {
    return Promise.reject(new Error("Extractor rollout policy is not available in this environment"));
  }
  return Promise.resolve(bridge.SaveExtractorRolloutPolicy(policy)) as Promise<ExtractorRolloutPolicy>;
}

export function runExtractorValidationRunbook(req: ExtractorValidationRunRequest) {
  const bridge = getDiagnosticsBridge();
  if (!bridge?.RunExtractorValidationRunbook) {
    return Promise.reject(new Error("Extractor validation runbook is not available in this environment"));
  }
  return Promise.resolve(bridge.RunExtractorValidationRunbook(req)) as Promise<ExtractorValidationReport>;
}

export function runExtractorLiveValidationSession(req: ExtractorValidationRunRequest) {
  const bridge = getDiagnosticsBridge();
  if (!bridge?.RunExtractorLiveValidationSession) {
    return Promise.reject(new Error("Extractor live validation is not available in this environment"));
  }
  return Promise.resolve(bridge.RunExtractorLiveValidationSession(req)) as Promise<ExtractorLiveValidationReport>;
}
