import {
  Bookmark,
  Download,
  FileOutput,
  FolderOpen,
  Heart,
  Images,
  MoreVertical,
  Pencil,
  StopCircle,
  Trash2,
} from "lucide-react";
import { VList } from "virtua";

import {
  formatNumberWithComma,
  getRelativeTime,
  isPrivateAccount,
} from "@/lib/database/helpers";
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
import { Spinner } from "@/components/ui/spinner";
import { cn, openExternal } from "@/lib/utils";

interface DatabaseAccountsListProps {
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

export function DatabaseAccountsList({
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
}: DatabaseAccountsListProps) {
  return (
    <VList
      data={accounts}
      style={{ height: "68vh" }}
      className="rounded-2xl border border-border/70 bg-background/40"
    >
      {(account, index) => (
        <div
          key={account.id}
          className={cn(
            "border-b border-border/60 px-4 py-3 transition-colors",
            selectedIds.has(account.id) ? "bg-primary/6" : "hover:bg-muted/35"
          )}
        >
          <div className="flex items-center gap-4">
            <Checkbox
              checked={selectedIds.has(account.id)}
              onCheckedChange={() => onToggleSelect(account.id)}
            />
            <span className="w-8 shrink-0 text-center text-sm text-muted-foreground">
              {index + 1}
            </span>
            <Button
              variant="ghost"
              className="h-auto rounded-full p-0 hover:bg-transparent"
              onClick={() => void onView(account)}
              aria-label={`Open saved account ${account.username}`}
            >
              {isPrivateAccount(account.username) ? (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  {account.username === "bookmarks" ? (
                    <Bookmark className="h-6 w-6 text-primary" />
                  ) : (
                    <Heart className="h-6 w-6 text-primary" />
                  )}
                </div>
              ) : (
                <img
                  src={account.profile_image}
                  alt={account.name}
                  className="h-12 w-12 rounded-full"
                  loading="lazy"
                />
              )}
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">{account.name}</span>
                <Badge variant="secondary" className="text-xs flex items-center gap-1">
                  <Images className="h-3 w-3" />
                  {formatNumberWithComma(account.total_media)}
                </Badge>
                {!account.completed ? (
                  <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">
                    Incomplete
                  </Badge>
                ) : null}
                {account.group_name ? (
                  <Badge
                    variant="outline"
                    className="text-xs"
                    style={{
                      borderColor: account.group_color,
                      color: account.group_color,
                    }}
                  >
                    {account.group_name}
                  </Badge>
                ) : null}
              </div>
              {!isPrivateAccount(account.username) ? (
                <button
                  type="button"
                  onClick={() => openExternal(`https://x.com/${account.username}`)}
                  className="text-sm text-muted-foreground hover:text-primary hover:underline"
                >
                  @{account.username}
                </button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {account.username === "bookmarks" ? "My Bookmarks" : "My Likes"}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                {account.last_fetched} {getRelativeTime(account.last_fetched)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {downloadingAccountId === account.id ? (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void onStopDownload?.()}
                  aria-label={`Stop download for ${account.username}`}
                >
                  <StopCircle className="h-4 w-4 text-destructive" />
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="icon"
                  onClick={() => void onDownload(account.id, account.username)}
                  disabled={isDownloading}
                  aria-label={`Download saved media for ${account.username}`}
                >
                  {isDownloading && downloadingAccountId === account.id ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>
              )}
              <Button
                variant="outline"
                size="icon"
                onClick={() => void onOpenFolder(account.username)}
                disabled={!folderExistence.get(account.id)}
                aria-label={`Open download folder for ${account.username}`}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`More actions for ${account.username}`}
                  >
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
                    className="text-destructive focus:text-destructive"
                    onClick={() => void onDelete(account.id, account.username)}
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
                  Downloading {downloadProgress.current} of {downloadProgress.total}
                </span>
                <span className="font-medium">{downloadProgress.percent}%</span>
              </div>
              <Progress value={downloadProgress.percent} className="h-1.5" />
            </div>
          ) : null}
        </div>
      )}
    </VList>
  );
}
