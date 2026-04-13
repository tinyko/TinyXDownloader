import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatNumberWithComma } from "@/lib/database/helpers";
import type { HistoryItem } from "@/types/fetch";

interface DatabaseRecentFetchesProps {
  recentFetches: HistoryItem[];
  onSelectRecentFetch?: (item: HistoryItem) => void;
  onRemoveRecentFetch?: (id: string) => void;
  onClearRecentFetches?: () => void;
}

export function DatabaseRecentFetches({
  recentFetches,
  onSelectRecentFetch,
  onRemoveRecentFetch,
  onClearRecentFetches,
}: DatabaseRecentFetchesProps) {
  if (recentFetches.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Recent Fetches</h3>
          <p className="text-xs text-muted-foreground">
            Reopen a recent username in the fetch workspace without retyping.
          </p>
        </div>
        {onClearRecentFetches ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-lg px-2 text-xs"
            onClick={onClearRecentFetches}
          >
            Clear All
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {recentFetches.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-full border border-border/70 bg-card px-2.5 py-1.5 shadow-sm"
          >
            {item.image ? (
              <img
                src={item.image}
                alt={item.name}
                className="h-6 w-6 rounded-full"
                loading="lazy"
              />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold uppercase text-muted-foreground">
                {item.username.charAt(0)}
              </div>
            )}

            <button
              type="button"
              className="min-w-0 text-left"
              onClick={() => onSelectRecentFetch?.(item)}
            >
              <p className="truncate text-sm font-medium leading-none">
                @{item.username}
              </p>
              <p className="mt-1 text-[11px] leading-none text-muted-foreground">
                {formatNumberWithComma(item.mediaCount)} items
              </p>
            </button>

            {onRemoveRecentFetch ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-full"
                onClick={() => onRemoveRecentFetch(item.id)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
