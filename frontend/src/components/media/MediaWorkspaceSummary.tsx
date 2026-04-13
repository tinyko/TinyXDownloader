import { Bookmark, Heart } from "lucide-react";

import type { AccountInfo } from "@/types/api";
import {
  formatNumberWithComma,
  getAccountSummaryStats,
} from "@/lib/media/utils";

interface MediaWorkspaceSummaryProps {
  accountInfo: AccountInfo;
  totalUrls: number;
  newMediaCount?: number | null;
}

export function MediaWorkspaceSummary({
  accountInfo,
  totalUrls,
  newMediaCount = null,
}: MediaWorkspaceSummaryProps) {
  if (accountInfo.name === "bookmarks" || accountInfo.name === "likes") {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          {accountInfo.name === "bookmarks" ? (
            <Bookmark className="h-8 w-8 text-primary" />
          ) : (
            <Heart className="h-8 w-8 text-primary" />
          )}
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{accountInfo.nick}</h2>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            {newMediaCount !== null && newMediaCount > 0 ? (
              <div className="animate-in slide-in-from-left-2 fade-in text-lg font-semibold text-green-600 duration-300 dark:text-green-400">
                {formatNumberWithComma(newMediaCount)}+
              </div>
            ) : null}
            <div className="text-xl font-bold text-primary">
              {formatNumberWithComma(totalUrls)}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">items found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
      <img
        src={accountInfo.profile_image}
        alt={accountInfo.nick}
        className="h-14 w-14 rounded-full"
      />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-lg">{accountInfo.nick}</h2>
          <span className="text-sm text-muted-foreground">@{accountInfo.name}</span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          {getAccountSummaryStats(accountInfo).map((stat) => {
            if (!stat) {
              return null;
            }

            const Icon = stat.icon;
            return (
              <span key={stat.key} className="flex items-center gap-1">
                <Icon className="h-3.5 w-3.5" />
                {stat.text}
              </span>
            );
          })}
        </div>
      </div>
      <div className="text-right">
        <div className="flex items-center justify-end gap-2">
          {newMediaCount !== null && newMediaCount > 0 ? (
            <div className="animate-in slide-in-from-left-2 fade-in text-lg font-semibold text-green-600 duration-300 dark:text-green-400">
              {formatNumberWithComma(newMediaCount)}+
            </div>
          ) : null}
          <div className="text-xl font-bold text-primary">{formatNumberWithComma(totalUrls)}</div>
        </div>
        <div className="text-xs text-muted-foreground">items found</div>
      </div>
    </div>
  );
}
