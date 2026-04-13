import type { AccountListItem } from "@/types/database";
import type {
  GlobalDownloadSessionMeta,
  GlobalDownloadState,
} from "@/types/download";

export interface UseDatabaseActionsOptions {
  accounts: AccountListItem[];
  selectedIds: Set<number>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  loadAccounts: () => Promise<void>;
  refreshFolderExistence: () => Promise<void>;
  onLoadAccount: (account: AccountListItem) => void | Promise<void>;
  onUpdateSelected?: (usernames: string[]) => void;
  onStopDownload?: () => void | Promise<void>;
  onDownloadSessionStart?: (meta: GlobalDownloadSessionMeta) => void;
  downloadState?: GlobalDownloadState | null;
}
