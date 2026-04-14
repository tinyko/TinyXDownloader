import { useMemo, useRef, useState } from "react";

import {
  buildScopeRequest,
  formatNumberWithComma,
  isPrivateAccount,
} from "@/lib/database/helpers";
import type { AccountListItem } from "@/types/database";
import { getSettings } from "@/lib/settings";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import type { UseDatabaseActionsOptions } from "@/hooks/database/databaseActionTypes";
import { DownloadSavedScopes, GetFolderPath, OpenFolder } from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";

type UseDatabaseDownloadActionsArgs = Pick<
  UseDatabaseActionsOptions,
  | "accounts"
  | "accountRefs"
  | "selectedIds"
  | "resolveAccountsByIds"
  | "refreshFolderExistence"
  | "onStopDownload"
  | "onDownloadSessionStart"
  | "onDownloadSessionFinish"
  | "onDownloadSessionFail"
  | "downloadState"
>;

export function useDatabaseDownloadActions({
  accounts,
  accountRefs,
  selectedIds,
  resolveAccountsByIds,
  refreshFolderExistence,
  onStopDownload,
  onDownloadSessionStart,
  onDownloadSessionFinish,
  onDownloadSessionFail,
  downloadState = null,
}: UseDatabaseDownloadActionsArgs) {
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [bulkDownloadCurrent, setBulkDownloadCurrent] = useState(0);
  const [bulkDownloadTotal, setBulkDownloadTotal] = useState(0);
  const stopBulkDownloadRef = useRef(false);

  const isDownloading = Boolean(downloadState?.in_progress);

  const hasPrivateAccountSelected = useMemo(() => {
    if (selectedIds.size === 0) {
      return false;
    }
    const refsById = new Map(accountRefs.map((account) => [account.id, account.username]));
    return Array.from(selectedIds).some((id) => {
      const username = refsById.get(id);
      return username ? isPrivateAccount(username) : false;
    });
  }, [accountRefs, selectedIds]);

  const handleOpenFolder = async (username: string) => {
    const settings = getSettings();
    let folderName = username;
    if (username === "bookmarks") {
      folderName = "My Bookmarks";
    } else if (username === "likes") {
      folderName = "My Likes";
    }
    const folderPath = await GetFolderPath(settings.downloadPath, folderName);
    try {
      await OpenFolder(folderPath);
    } catch {
      toast.error("Failed to open folder");
    }
  };

  const handleDownload = async (id: number, username: string) => {
    try {
      const account = accounts.find((entry) => entry.id === id);
      if (!account || account.total_media === 0) {
        toast.error("No media to download");
        return;
      }

      const settings = getSettings();
      onDownloadSessionStart?.({
        source: "database-single",
        title: `Downloading @${account.username}`,
        subtitle: `${formatNumberWithComma(account.total_media)} saved item(s)`,
        accountId: id,
        accountName: account.username,
      });

      const response = await DownloadSavedScopes(
        new main.DownloadSavedScopesRequest({
          scopes: [buildScopeRequest(account)],
          output_dir: settings.downloadPath || "",
          proxy: settings.proxy || "",
        })
      );

      if (!response.success) {
        onDownloadSessionFail?.();
        toast.error(response.message || "Download failed");
        return;
      }

      await refreshFolderExistence();
      const parts: string[] = [];
      if (response.downloaded > 0) {
        parts.push(`${response.downloaded} file${response.downloaded !== 1 ? "s" : ""} downloaded`);
      }
      if (response.skipped > 0) {
        parts.push(
          `${response.skipped} file${response.skipped !== 1 ? "s" : ""} already exist${
            response.skipped !== 1 ? "" : "s"
          }`
        );
      }
      if (response.failed > 0) {
        parts.push(`${response.failed} failed`);
      }

      const message =
        parts.length > 0
          ? `${parts.join(", ")} for @${username}`
          : `Download completed for @${username}`;

      if (response.downloaded === 0 && response.failed === 0 && response.skipped > 0) {
        toast.info(message);
      } else {
        toast.success(message);
      }
      onDownloadSessionFinish?.(response.failed > 0 ? "failed" : "completed");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      onDownloadSessionFail?.();
      toast.error(`Download failed: ${errorMsg}`);
    }
  };

  const handleBulkDownload = async () => {
    const idsToDownload = Array.from(selectedIds);
    if (idsToDownload.length === 0) {
      toast.error("No accounts selected");
      return;
    }

    setIsBulkDownloading(true);
    setBulkDownloadTotal(idsToDownload.length);
    setBulkDownloadCurrent(0);
    stopBulkDownloadRef.current = false;

    const settings = getSettings();
    const selectedAccounts = (await resolveAccountsByIds(idsToDownload)).filter(
      (account): account is AccountListItem => account.total_media > 0
    );

    if (selectedAccounts.length === 0) {
      setIsBulkDownloading(false);
      setBulkDownloadCurrent(0);
      setBulkDownloadTotal(0);
      toast.error("No media to download");
      return;
    }

    const totalItems = selectedAccounts.reduce((sum, account) => sum + account.total_media, 0);
    onDownloadSessionStart?.({
      source: "database-bulk",
      title: `Bulk downloading ${selectedAccounts.length} accounts`,
      subtitle: `${formatNumberWithComma(totalItems)} saved item(s)`,
    });

    let response: Awaited<ReturnType<typeof DownloadSavedScopes>> | null = null;
    try {
      response = await DownloadSavedScopes(
        new main.DownloadSavedScopesRequest({
          scopes: selectedAccounts.map((account) => buildScopeRequest(account)),
          output_dir: settings.downloadPath || "",
          proxy: settings.proxy || "",
        })
      );
    } catch (error) {
      console.error("Bulk download failed:", error);
      onDownloadSessionFail?.();
    }

    setIsBulkDownloading(false);
    setBulkDownloadCurrent(0);
    setBulkDownloadTotal(0);

    if (
      response?.success &&
      (response.downloaded > 0 || response.skipped > 0) &&
      !stopBulkDownloadRef.current
    ) {
      await refreshFolderExistence();
      const parts: string[] = [];
      if (response.downloaded > 0) {
        parts.push(`${response.downloaded} file${response.downloaded !== 1 ? "s" : ""} downloaded`);
      }
      if (response.skipped > 0) {
        parts.push(
          `${response.skipped} file${response.skipped !== 1 ? "s" : ""} already exist${
            response.skipped !== 1 ? "" : "s"
          }`
        );
      }
      const message =
        parts.length > 0
          ? `${parts.join(", ")} from ${selectedAccounts.length} account${
              selectedAccounts.length !== 1 ? "s" : ""
            }`
          : `Download completed from ${selectedAccounts.length} account${
              selectedAccounts.length !== 1 ? "s" : ""
            }`;

      if (response.downloaded === 0 && response.skipped > 0) {
        toast.info(message);
      } else {
        toast.success(message);
      }
      onDownloadSessionFinish?.(response.failed > 0 ? "failed" : "completed");
    } else if (response && !response.success && !stopBulkDownloadRef.current) {
      onDownloadSessionFail?.();
      toast.error(response.message || "Bulk download failed");
    }
  };

  const handleStopBulkDownload = async () => {
    stopBulkDownloadRef.current = true;
    await onStopDownload?.();
  };

  return {
    isBulkDownloading,
    bulkDownloadCurrent,
    bulkDownloadTotal,
    isDownloading,
    hasPrivateAccountSelected,
    handleOpenFolder,
    handleDownload,
    handleBulkDownload,
    handleStopBulkDownload,
  };
}
