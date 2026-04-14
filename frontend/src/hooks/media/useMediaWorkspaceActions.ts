import { useCallback, useMemo, useState } from "react";

import type { AccountInfo } from "@/types/api";
import type {
  DownloadSessionResultStatus,
  GlobalDownloadSessionMeta,
  GlobalDownloadState,
} from "@/types/download";
import { getMediaAccountFolderName } from "@/lib/media/client";
import { useMediaDownloadActions } from "@/hooks/media/useMediaDownloadActions";
import { useMediaToolingState } from "@/hooks/media/useMediaToolingState";

interface UseMediaWorkspaceActionsArgs {
  accountInfo: AccountInfo;
  onDownloadSessionStart?: (meta: GlobalDownloadSessionMeta) => void;
  onDownloadSessionFinish?: (status?: DownloadSessionResultStatus) => void;
  onDownloadSessionFail?: () => void;
  downloadState?: GlobalDownloadState | null;
  downloadMeta?: GlobalDownloadSessionMeta | null;
}

export function useMediaWorkspaceActions({
  accountInfo,
  onDownloadSessionStart,
  onDownloadSessionFinish,
  onDownloadSessionFail,
  downloadState = null,
  downloadMeta = null,
}: UseMediaWorkspaceActionsArgs) {
  const [refreshVersion, setRefreshVersion] = useState(0);

  const accountFolderName = useMemo(
    () => getMediaAccountFolderName(accountInfo),
    [accountInfo]
  );

  const handleRefreshArtifacts = useCallback(() => {
    setRefreshVersion((current) => current + 1);
  }, []);

  const downloadActions = useMediaDownloadActions({
    accountInfo,
    onDownloadSessionStart,
    onDownloadSessionFinish,
    onDownloadSessionFail,
    downloadState,
    downloadMeta,
    onRefreshArtifacts: handleRefreshArtifacts,
  });

  const toolingState = useMediaToolingState({
    accountFolderName,
    refreshKey: `${accountFolderName}|${refreshVersion}`,
  });

  return {
    ...downloadActions,
    ...toolingState,
  };
}
