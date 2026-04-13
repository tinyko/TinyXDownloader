import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";

import {
  formatDate,
  formatNumberWithComma,
  getPreviewUrl,
} from "@/lib/saved/timeline-helpers";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/utils";
import type { SavedTimelineItem } from "@/types/api";

interface SavedTimelinePreviewOverlayProps {
  item: SavedTimelineItem;
  itemIndex: number;
  totalItems: number;
  accountUsername: string;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function SavedTimelinePreviewOverlay({
  item,
  itemIndex,
  totalItems,
  accountUsername,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onClose,
}: SavedTimelinePreviewOverlayProps) {
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/80 pt-8"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      {hasPrevious ? (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-4 top-1/2 z-10 h-12 w-12 -translate-y-1/2 text-white hover:bg-white/20"
          onClick={onPrevious}
        >
          <ChevronLeft className="h-8 w-8" />
        </Button>
      ) : null}

      <div className="mb-4 rounded-full bg-black/50 px-4 py-1.5 text-sm text-white">
        {formatNumberWithComma(itemIndex + 1)} / {formatNumberWithComma(totalItems)}
      </div>

      <div className="flex max-h-[70%] max-w-[90%] items-center justify-center">
        {item.type === "photo" ? (
          <img
            src={getPreviewUrl(item.url)}
            alt=""
            className="max-h-[70vh] max-w-[90vw] rounded-lg object-contain"
          />
        ) : item.type === "video" ||
          item.type === "gif" ||
          item.type === "animated_gif" ? (
          <video
            src={item.url}
            className="max-h-[70vh] max-w-[90vw] rounded-lg"
            controls
            autoPlay
            muted
            loop={item.type !== "video"}
          />
        ) : (
          <div className="max-w-3xl rounded-2xl bg-white p-8 text-black shadow-2xl">
            <p className="whitespace-pre-wrap text-base leading-7">
              {item.content || "No text content available."}
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-black/50 px-4 py-3 text-white">
        <p className="text-sm">
          {item.tweet_id} • {formatDate(item.date)}
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            openExternal(`https://x.com/${accountUsername}/status/${item.tweet_id}`)
          }
        >
          <ExternalLink className="h-4 w-4" />
          Open Tweet
        </Button>
      </div>

      {hasNext ? (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-4 top-1/2 z-10 h-12 w-12 -translate-y-1/2 text-white hover:bg-white/20"
          onClick={onNext}
        >
          <ChevronRight className="h-8 w-8" />
        </Button>
      ) : null}
    </div>
  );
}
