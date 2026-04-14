import type {
  FontFamily,
  GifQuality,
  GifResolution,
  Settings,
  FetchMode as SettingsFetchMode,
  MediaType as SettingsMediaType,
} from "@/lib/settings";
import type { FetchMode, PrivateType } from "@/types/fetch";
import type { TaskLifecycleStatus } from "@/types/tasks";

export type {
  FontFamily,
  GifQuality,
  GifResolution,
  Settings,
  SettingsFetchMode,
  SettingsMediaType,
};

export type DownloadIntegrityMode = "quick" | "deep";

export interface DownloadIntegrityIssue {
  path: string;
  relative_path: string;
  reason: string;
  local_size: number;
  remote_size: number;
  url?: string;
}

export interface DownloadIntegrityReport {
  mode: DownloadIntegrityMode;
  download_path: string;
  scanned_files: number;
  checked_files: number;
  complete_files: number;
  partial_files: number;
  incomplete_files: number;
  untracked_files: number;
  unverifiable_files: number;
  issues: DownloadIntegrityIssue[];
}

export interface DownloadIntegrityTaskStatus {
  status: TaskLifecycleStatus;
  in_progress: boolean;
  cancelled: boolean;
  mode: DownloadIntegrityMode | "";
  phase: string;
  scanned_files: number;
  checked_files: number;
  verified_files: number;
  partial_files: number;
  incomplete_files: number;
  untracked_files: number;
  unverifiable_files: number;
  issues_count: number;
  error?: string;
  report?: DownloadIntegrityReport | null;
}

export interface SettingsPanelProps {
  embedded?: boolean;
  mode?: FetchMode;
  privateType?: PrivateType;
  publicAuthToken?: string;
  privateAuthToken?: string;
  onPublicAuthTokenChange?: (value: string) => void;
  onPrivateAuthTokenChange?: (value: string) => void;
  rememberPublicToken?: boolean;
  rememberPrivateToken?: boolean;
  onRememberPublicTokenChange?: (value: boolean) => void;
  onRememberPrivateTokenChange?: (value: boolean) => void;
  useDateRange?: boolean;
  startDate?: string;
  endDate?: string;
  onUseDateRangeChange?: (value: boolean) => void;
  onStartDateChange?: (value: string) => void;
  onEndDateChange?: (value: string) => void;
  integrityTaskStatus?: DownloadIntegrityTaskStatus | null;
  integrityReport?: DownloadIntegrityReport | null;
  showIntegrityReport?: boolean;
  onCheckIntegrityTask?: (
    downloadPath: string,
    proxy: string,
    mode: DownloadIntegrityMode
  ) => void | Promise<void>;
  onCancelIntegrityTask?: () => void | Promise<void>;
  onShowIntegrityReportChange?: (value: boolean) => void;
  onOpenIntegrityFolder?: () => void | Promise<void>;
}
