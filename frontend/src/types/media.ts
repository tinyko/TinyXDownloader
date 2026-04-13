import type { AccountInfo, TimelineEntry } from "@/types/api";
import type { GlobalDownloadSessionMeta, GlobalDownloadState } from "@/types/download";

export interface MediaWorkspaceProps {
  accountInfo: AccountInfo;
  timeline: TimelineEntry[];
  totalUrls: number;
  fetchedMediaType?: string;
  newMediaCount?: number | null;
  downloadState?: GlobalDownloadState | null;
  downloadMeta?: GlobalDownloadSessionMeta | null;
  onDownloadSessionStart?: (meta: GlobalDownloadSessionMeta) => void;
}

export type MediaWorkspaceViewMode = "gallery" | "list";
