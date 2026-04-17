import type { AccountInfo, TimelineEntry } from "@/types/api";
import type {
  DownloadSessionFailHandler,
  DownloadSessionFinishHandler,
  GlobalDownloadSessionMeta,
  GlobalDownloadState,
} from "@/types/download";

export interface MediaWorkspaceProps {
  accountInfo: AccountInfo;
  timeline: TimelineEntry[];
  totalUrls: number;
  fetchedMediaType?: string;
  newMediaCount?: number | null;
  downloadState?: GlobalDownloadState | null;
  downloadMeta?: GlobalDownloadSessionMeta | null;
  onDownloadSessionStart?: (meta: GlobalDownloadSessionMeta) => void;
  onDownloadSessionFinish?: DownloadSessionFinishHandler;
  onDownloadSessionFail?: DownloadSessionFailHandler;
}

export type MediaWorkspaceViewMode = "gallery" | "list";
