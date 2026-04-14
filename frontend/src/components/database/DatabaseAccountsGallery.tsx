import {
  AlertCircle,
  Bookmark,
  Download,
  FileOutput,
  FileText,
  Film,
  FolderOpen,
  Heart,
  Image,
  Images,
  MoreVertical,
  Pencil,
  StopCircle,
  Trash2,
  Video,
} from "lucide-react";

import { formatNumberWithComma, isPrivateAccount } from "@/lib/database/helpers";
import type { AccountListItem } from "@/types/database";
import type { GlobalDownloadState } from "@/types/download";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { cn, openExternal } from "@/lib/utils";

interface DatabaseAccountsGalleryProps {
  accounts: AccountListItem[];
  selectedIds: Set<number>;
  folderExistence: Map<number, boolean>;
  downloadingAccountId: number | null;
  downloadProgress: GlobalDownloadState | null;
  isDownloading: boolean;
  onToggleSelect: (id: number) => void;
  onView: (account: AccountListItem) => void | Promise<void>;
  onDownload: (id: number, username: string) => void | Promise<void>;
  onOpenFolder: (username: string) => void | Promise<void>;
  onEditGroup: (account: AccountListItem) => void;
  onExportAccount: (account: AccountListItem) => void | Promise<void>;
  onDelete: (id: number, username: string) => void | Promise<void>;
  onStopDownload?: () => void | Promise<void>;
}

export function DatabaseAccountsGallery({
  accounts,
  selectedIds,
  folderExistence,
  downloadingAccountId,
  downloadProgress,
  isDownloading,
  onToggleSelect,
  onView,
  onDownload,
  onOpenFolder,
  onEditGroup,
  onExportAccount,
  onDelete,
  onStopDownload,
}: DatabaseAccountsGalleryProps) {
  return (
    <div
      className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4"
      data-testid="saved-accounts-gallery"
    >
      {accounts.map((account) => (
        <div
          key={account.id}
          data-testid={`saved-account-card-${account.username}`}
          className={cn(
            "relative rounded-lg border p-4 transition-colors",
            selectedIds.has(account.id)
              ? "border-primary bg-primary/5"
              : "bg-card hover:bg-muted/50"
          )}
        >
          <Checkbox
            checked={selectedIds.has(account.id)}
            onCheckedChange={() => onToggleSelect(account.id)}
            className="absolute left-2 top-2 z-10"
          />

          <div className="absolute right-2 top-2 z-10 flex gap-1">
            <Badge
              variant="secondary"
              className={cn(
                "flex items-center gap-1 text-xs",
                account.media_type === "text" &&
                  "bg-orange-500/20 text-orange-600 dark:text-orange-400",
                account.media_type === "image" &&
                  "bg-blue-500/20 text-blue-600 dark:text-blue-400",
                account.media_type === "video" &&
                  "bg-purple-500/20 text-purple-600 dark:text-purple-400",
                account.media_type === "gif" &&
                  "bg-green-500/20 text-green-600 dark:text-green-400",
                (!account.media_type || account.media_type === "all") &&
                  "bg-indigo-500/20 text-indigo-600 dark:text-indigo-400"
              )}
            >
              {account.media_type === "text" ? (
                <FileText className="h-3 w-3" />
              ) : account.media_type === "image" ? (
                <Image className="h-3 w-3" />
              ) : account.media_type === "video" ? (
                <Video className="h-3 w-3" />
              ) : account.media_type === "gif" ? (
                <Film className="h-3 w-3" />
              ) : (
                <Images className="h-3 w-3" />
              )}
            </Badge>
            {!account.completed ? (
              <Badge
                variant="secondary"
                className="text-xs bg-yellow-500/20 text-yellow-600 dark:text-yellow-400"
              >
                <AlertCircle className="h-3 w-3" />
              </Badge>
            ) : null}
          </div>

          <div className="flex flex-col items-center gap-3 pt-4 text-center">
            {isPrivateAccount(account.username) ? (
              <div
                className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-full bg-primary/10 transition-colors hover:bg-primary/20"
                onClick={() => void onView(account)}
              >
                {account.username === "bookmarks" ? (
                  <Bookmark className="h-10 w-10 text-primary" />
                ) : (
                  <Heart className="h-10 w-10 text-primary" />
                )}
              </div>
            ) : (
              <img
                src={account.profile_image}
                alt={account.name}
                className="h-20 w-20 cursor-pointer rounded-full transition-opacity hover:opacity-80"
                onClick={() => void onView(account)}
                loading="lazy"
              />
            )}
            <div className="w-full min-w-0">
              <div className="truncate font-medium">{account.name}</div>
              {!isPrivateAccount(account.username) ? (
                <button
                  type="button"
                  onClick={() => openExternal(`https://x.com/${account.username}`)}
                  className="text-sm text-muted-foreground hover:text-primary hover:underline"
                >
                  @{account.username}
                </button>
              ) : null}
              <div className="mt-1 text-sm text-muted-foreground">
                {formatNumberWithComma(account.total_media)} media
              </div>
            </div>
            <div className="flex gap-1">
              {downloadingAccountId === account.id ? (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => void onStopDownload?.()}
                  data-testid={`saved-account-stop-download-${account.username}`}
                >
                  <StopCircle className="h-4 w-4 text-destructive" />
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => void onDownload(account.id, account.username)}
                  disabled={isDownloading}
                  data-testid={`saved-account-download-${account.username}`}
                >
                  <Download className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => void onOpenFolder(account.username)}
                disabled={!folderExistence.get(account.id)}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!isPrivateAccount(account.username) ? (
                    <DropdownMenuItem onClick={() => onEditGroup(account)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit Group
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onClick={() => void onExportAccount(account)}>
                    <FileOutput className="mr-2 h-4 w-4" />
                    Export JSON
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void onDelete(account.id, account.username)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {downloadingAccountId === account.id && downloadProgress ? (
            <div className="mt-3 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {downloadProgress.current}/{downloadProgress.total}
                </span>
                <span className="font-medium">{downloadProgress.percent}%</span>
              </div>
              <Progress value={downloadProgress.percent} className="h-1.5" />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
