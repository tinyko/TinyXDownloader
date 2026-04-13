import { Bookmark, Download, FileOutput, FolderOpen, Heart } from "lucide-react";

import { formatNumberWithComma, isPrivateAccount } from "@/lib/database/helpers";
import type { AccountListItem } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface DatabaseSelectionSummaryProps {
  selectedAccounts: AccountListItem[];
  focusedAccount: AccountListItem | null;
  folderExistence: Map<number, boolean>;
  isDownloading: boolean;
  onView: (account: AccountListItem) => void | Promise<void>;
  onDownload: (id: number, username: string) => void | Promise<void>;
  onOpenFolder: (username: string) => void | Promise<void>;
  onExportJSON: () => void | Promise<void>;
  onBulkDownload: () => void | Promise<void>;
}

export function DatabaseSelectionSummary({
  selectedAccounts,
  focusedAccount,
  folderExistence,
  isDownloading,
  onView,
  onDownload,
  onOpenFolder,
  onExportJSON,
  onBulkDownload,
}: DatabaseSelectionSummaryProps) {
  if (selectedAccounts.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
      {focusedAccount ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Selected Account
            </p>
            <div className="mt-2 flex items-center gap-3">
              {isPrivateAccount(focusedAccount.username) ? (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  {focusedAccount.username === "bookmarks" ? (
                    <Bookmark className="h-5 w-5 text-primary" />
                  ) : (
                    <Heart className="h-5 w-5 text-primary" />
                  )}
                </div>
              ) : (
                <img
                  src={focusedAccount.profile_image}
                  alt={focusedAccount.name}
                  className="h-12 w-12 rounded-full"
                  loading="lazy"
                />
              )}
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">{focusedAccount.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  @{focusedAccount.username}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="secondary">
                {formatNumberWithComma(focusedAccount.total_media)} items
              </Badge>
              <Badge variant="secondary">
                {focusedAccount.media_type || "all"}
              </Badge>
              {!focusedAccount.completed ? (
                <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">
                  Incomplete
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              onClick={() => void onView(focusedAccount)}
            >
              View
            </Button>
            <Button
              className="h-10 rounded-xl"
              onClick={() => void onDownload(focusedAccount.id, focusedAccount.username)}
              disabled={isDownloading}
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              onClick={() => void onOpenFolder(focusedAccount.username)}
              disabled={!folderExistence.get(focusedAccount.id)}
            >
              <FolderOpen className="h-4 w-4" />
              Open Folder
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Selection Summary
            </p>
            <p className="mt-1 text-lg font-semibold">
              {formatNumberWithComma(selectedAccounts.length)} account(s) selected
            </p>
            <p className="text-sm text-muted-foreground">
              Bulk download, export, and update actions will use this selection.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              onClick={() => void onExportJSON()}
            >
              <FileOutput className="h-4 w-4" />
              Export JSON
            </Button>
            <Button
              className="h-10 rounded-xl"
              onClick={() => void onBulkDownload()}
              disabled={isDownloading}
            >
              <Download className="h-4 w-4" />
              Download Selected
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
