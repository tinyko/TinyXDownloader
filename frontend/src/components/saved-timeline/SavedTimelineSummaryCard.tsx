import { Image } from "lucide-react";

import { formatNumberWithComma } from "@/lib/saved/timeline-helpers";

interface SavedTimelineSummaryCardProps {
  profileImage?: string;
  displayName: string;
  username: string;
  totalItems: number;
}

export function SavedTimelineSummaryCard({
  profileImage,
  displayName,
  username,
  totalItems,
}: SavedTimelineSummaryCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
      {profileImage ? (
        <img
          src={profileImage}
          alt={displayName}
          className="h-14 w-14 rounded-full"
        />
      ) : (
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <Image className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{displayName}</h2>
          <span className="text-sm text-muted-foreground">@{username}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Saved results use paged loading for faster first open.
        </p>
      </div>
      <div className="text-right">
        <div className="text-xl font-bold text-primary">
          {formatNumberWithComma(totalItems)}
        </div>
        <div className="text-xs text-muted-foreground">saved items</div>
      </div>
    </div>
  );
}
