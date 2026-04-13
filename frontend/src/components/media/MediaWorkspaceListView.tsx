import { Download, ExternalLink, Repeat2 } from "lucide-react";
import { VList } from "virtua";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import type { TimelineEntry } from "@/types/api";
import type { IndexedTimelineEntry } from "@/hooks/media/useMediaTimelineModel";
import {
  formatDate,
  getDownloadStatusIcon,
  getMediaIcon,
  getRelativeTime,
  getThumbnailUrl,
} from "@/lib/media/utils";
import { cn } from "@/lib/utils";

interface MediaWorkspaceListViewProps {
  indexedTimeline: IndexedTimelineEntry<TimelineEntry>[];
  selectedItems: Set<string>;
  downloadedItems: Set<string>;
  failedItems: Set<string>;
  skippedItems: Set<string>;
  downloadingItem: string | null;
  onToggleItem: (itemKey: string) => void;
  onOpenPreview: (itemKey: string) => void;
  onSingleDownload: (item: TimelineEntry, itemKey: string) => void | Promise<void>;
  onOpenTweet: (tweetId: string) => void;
}

function getItemStatus(
  itemKey: string,
  downloadedItems: Set<string>,
  failedItems: Set<string>,
  skippedItems: Set<string>
) {
  if (skippedItems.has(itemKey)) return "skipped" as const;
  if (downloadedItems.has(itemKey)) return "downloaded" as const;
  if (failedItems.has(itemKey)) return "failed" as const;
  return "idle" as const;
}

export function MediaWorkspaceListView({
  indexedTimeline,
  selectedItems,
  downloadedItems,
  failedItems,
  skippedItems,
  downloadingItem,
  onToggleItem,
  onOpenPreview,
  onSingleDownload,
  onOpenTweet,
}: MediaWorkspaceListViewProps) {
  return (
    <VList
      data={indexedTimeline}
      style={{ height: "72vh" }}
      className="rounded-2xl border border-border/70 bg-background/40"
    >
      {(entry) => {
        const { item, index, key: itemKey } = entry;
        const isSelected = selectedItems.has(itemKey);
        const isItemDownloading = downloadingItem === itemKey;
        const status = getItemStatus(itemKey, downloadedItems, failedItems, skippedItems);
        const StatusIcon = getDownloadStatusIcon(status);

        return (
          <div
            key={itemKey}
            className={cn(
              "flex items-center gap-4 border-b border-border/60 px-4 py-3.5 transition-colors",
              isSelected ? "bg-primary/6" : "hover:bg-muted/35"
            )}
          >
            <Checkbox checked={isSelected} onCheckedChange={() => onToggleItem(itemKey)} />
            <span className="w-8 shrink-0 text-center text-sm text-muted-foreground">
              {index + 1}
            </span>
            <Button
              variant="ghost"
              className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-muted p-0 hover:bg-muted"
              onClick={() => onOpenPreview(itemKey)}
              aria-label={`Open preview for ${item.tweet_id}`}
            >
              {item.type === "photo" || item.type === "animated_gif" || item.type === "gif" ? (
                <img
                  src={getThumbnailUrl(item.url)}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  {getMediaIcon(item.type)}
                </div>
              )}
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{item.tweet_id}</p>
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-xs",
                    item.type === "photo" && "bg-blue-500/20 text-blue-700 dark:text-blue-300",
                    item.type === "video" && "bg-purple-500/20 text-purple-700 dark:text-purple-300",
                    item.type === "text" && "bg-orange-500/20 text-orange-700 dark:text-orange-300",
                    (item.type === "gif" || item.type === "animated_gif") &&
                      "bg-green-500/20 text-green-700 dark:text-green-300"
                  )}
                >
                  {getMediaIcon(item.type)}
                </Badge>
                {item.is_retweet ? (
                  <Badge variant="outline" className="px-1.5 text-xs">
                    <Repeat2 className="h-3 w-3" />
                  </Badge>
                ) : null}
                {StatusIcon ? <StatusIcon className="h-4 w-4 shrink-0" /> : null}
              </div>
              {item.type === "text" && item.content ? (
                <p className="mt-1 line-clamp-2 text-sm">{item.content}</p>
              ) : null}
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(item.date)} {getRelativeTime(item.date)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="icon"
                variant="default"
                aria-label={`Download media ${item.tweet_id}`}
                onClick={() => onSingleDownload(item, itemKey)}
                disabled={downloadingItem !== null}
              >
                {isItemDownloading ? (
                  <Spinner />
                ) : StatusIcon ? (
                  <StatusIcon className="h-4 w-4" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
              <Button
                size="icon"
                variant="outline"
                aria-label={`Open tweet ${item.tweet_id} on X`}
                onClick={() => onOpenTweet(item.tweet_id)}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      }}
    </VList>
  );
}
