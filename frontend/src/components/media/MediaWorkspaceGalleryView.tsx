import type { RefObject } from "react";
import { ExternalLink, FileCheck, Repeat2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import type { TimelineEntry } from "@/types/api";
import {
  formatDate,
  getDownloadStatusIcon,
  getMediaIcon,
  getRelativeTime,
  getThumbnailUrl,
} from "@/lib/media/utils";

interface MediaWorkspaceGalleryViewProps {
  items: TimelineEntry[];
  selectedItems: Set<string>;
  downloadedItems: Set<string>;
  failedItems: Set<string>;
  skippedItems: Set<string>;
  downloadingItem: string | null;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  hasMore: boolean;
  getItemKey: (item: TimelineEntry) => string;
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

export function MediaWorkspaceGalleryView({
  items,
  selectedItems,
  downloadedItems,
  failedItems,
  skippedItems,
  downloadingItem,
  loadMoreRef,
  hasMore,
  getItemKey,
  onToggleItem,
  onOpenPreview,
  onSingleDownload,
  onOpenTweet,
}: MediaWorkspaceGalleryViewProps) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {items.map((item, index) => {
          const itemKey = getItemKey(item);
          const isSelected = selectedItems.has(itemKey);
          const isItemDownloading = downloadingItem === itemKey;
          const status = getItemStatus(itemKey, downloadedItems, failedItems, skippedItems);
          const StatusIcon = getDownloadStatusIcon(status);

          return (
            <div
              key={itemKey}
              className={`group relative overflow-hidden rounded-2xl border-2 transition-all ${
                isSelected
                  ? "border-primary"
                  : "border-transparent hover:border-muted-foreground/30"
              }`}
              style={{ contentVisibility: "auto", containIntrinsicSize: "280px" }}
            >
              <Button
                variant="ghost"
                className="relative aspect-square h-auto w-full rounded-none bg-muted p-0 hover:bg-muted"
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
                  <div className="flex h-full w-full items-center justify-center bg-muted">
                    {getMediaIcon(item.type)}
                  </div>
                )}

                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="default"
                        className="h-8 w-8"
                        aria-label={`Download media ${item.tweet_id}`}
                        onClick={async (event) => {
                          event.stopPropagation();
                          await onSingleDownload(item, itemKey);
                        }}
                        disabled={downloadingItem !== null}
                      >
                        {isItemDownloading ? (
                          <Spinner />
                        ) : StatusIcon ? (
                          <StatusIcon className="h-4 w-4" />
                        ) : (
                          <FileCheck className="h-4 w-4 opacity-0" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {status === "downloaded"
                        ? "Downloaded"
                        : status === "failed"
                          ? "Failed"
                          : status === "skipped"
                            ? "Already exists"
                            : isItemDownloading
                              ? "Downloading..."
                              : "Download"}
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    aria-label={`Open tweet ${item.tweet_id} on X`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenTweet(item.tweet_id);
                    }}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>

                <div
                  className="absolute left-2 top-2"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggleItem(itemKey)}
                    className="bg-background/80"
                  />
                </div>

                <div className="absolute right-2 top-2">
                  <Badge
                    variant="secondary"
                    className={`px-1.5 py-0.5 text-xs ${
                      item.type === "photo"
                        ? "bg-blue-500/20 text-blue-700 dark:text-blue-300"
                        : item.type === "video"
                          ? "bg-purple-500/20 text-purple-700 dark:text-purple-300"
                          : item.type === "text"
                            ? "bg-orange-500/20 text-orange-700 dark:text-orange-300"
                            : "bg-green-500/20 text-green-700 dark:text-green-300"
                    }`}
                  >
                    {getMediaIcon(item.type)}
                  </Badge>
                </div>

                {item.is_retweet ? (
                  <div className="absolute bottom-2 right-2">
                    <Badge variant="outline" className="bg-background/80 px-1.5 py-0.5 text-xs">
                      <Repeat2 className="h-3 w-3" />
                    </Badge>
                  </div>
                ) : null}

                <div className="absolute bottom-2 left-2">
                  <span className="rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
                    {index + 1}
                  </span>
                </div>
              </Button>

              <div className="p-2 text-xs text-muted-foreground">
                <div className="truncate">{formatDate(item.date)}</div>
                <div className="mt-0.5 text-[10px]">{getRelativeTime(item.date)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {hasMore ? (
        <div ref={loadMoreRef} className="flex h-20 w-full items-center justify-center">
          <Spinner />
        </div>
      ) : null}
    </>
  );
}
