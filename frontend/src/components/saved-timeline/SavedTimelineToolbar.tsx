import { Download, FolderOpen, LayoutGrid, List } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MediaTypeCounts } from "@/types/api";
import { formatNumberWithComma } from "@/lib/saved/timeline-helpers";

interface SavedTimelineToolbarProps {
  sortBy: string;
  onSortByChange: (value: string) => void;
  filterType: string;
  onFilterTypeChange: (value: string) => void;
  mediaCounts: MediaTypeCounts;
  totalItems: number;
  viewMode: "gallery" | "list";
  onViewModeChange: (value: "gallery" | "list") => void;
  folderExists: boolean;
  onOpenFolder: () => void | Promise<void>;
  onDownload: () => void | Promise<void>;
  disablePrimaryDownloadAction: boolean;
  selectionCount: number;
  indexedItemCount: number;
  allLoadedSelected: boolean;
  onToggleSelectAll: () => void;
  hasMore: boolean;
}

export function SavedTimelineToolbar({
  sortBy,
  onSortByChange,
  filterType,
  onFilterTypeChange,
  mediaCounts,
  totalItems,
  viewMode,
  onViewModeChange,
  folderExists,
  onOpenFolder,
  onDownload,
  disablePrimaryDownloadAction,
  selectionCount,
  indexedItemCount,
  allLoadedSelected,
  onToggleSelectAll,
  hasMore,
}: SavedTimelineToolbarProps) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={sortBy} onValueChange={onSortByChange}>
          <SelectTrigger className="h-9 w-auto rounded-xl px-3 text-sm">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date-desc">Newest</SelectItem>
            <SelectItem value="date-asc">Oldest</SelectItem>
            <SelectItem value="tweet-id-desc">Tweet ID Desc</SelectItem>
            <SelectItem value="tweet-id-asc">Tweet ID Asc</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterType} onValueChange={onFilterTypeChange}>
          <SelectTrigger className="h-9 w-auto rounded-xl px-3 text-sm">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ({formatNumberWithComma(totalItems)})</SelectItem>
            {mediaCounts.photo > 0 ? (
              <SelectItem value="photo">Images ({formatNumberWithComma(mediaCounts.photo)})</SelectItem>
            ) : null}
            {mediaCounts.video > 0 ? (
              <SelectItem value="video">Videos ({formatNumberWithComma(mediaCounts.video)})</SelectItem>
            ) : null}
            {mediaCounts.gif > 0 ? (
              <SelectItem value="gif">GIFs ({formatNumberWithComma(mediaCounts.gif)})</SelectItem>
            ) : null}
            {mediaCounts.text > 0 ? (
              <SelectItem value="text">Text ({formatNumberWithComma(mediaCounts.text)})</SelectItem>
            ) : null}
          </SelectContent>
        </Select>

        <div className="flex items-center rounded-xl border">
          <Button
            variant={viewMode === "gallery" ? "secondary" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-r-none"
            onClick={() => onViewModeChange("gallery")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-l-none border-l"
            onClick={() => onViewModeChange("list")}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1" />

        <Button
          variant="outline"
          className="h-9 rounded-xl px-3 text-sm"
          onClick={() => void onOpenFolder()}
          disabled={!folderExists}
        >
          <FolderOpen className="h-4 w-4" />
          Open Folder
        </Button>
        <Button
          className="h-9 rounded-xl px-3 text-sm"
          onClick={() => void onDownload()}
          disabled={disablePrimaryDownloadAction}
        >
          <Download className="h-4 w-4" />
          {selectionCount > 0 ? `Download ${selectionCount}` : "Download All Saved"}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox checked={allLoadedSelected} onCheckedChange={onToggleSelectAll} />
        <span className="text-xs text-muted-foreground">
          Select loaded ({formatNumberWithComma(indexedItemCount)} items)
        </span>
        {selectionCount > 0 ? (
          <Badge variant="secondary">{formatNumberWithComma(selectionCount)} selected</Badge>
        ) : null}
        {hasMore ? (
          <Badge variant="outline">
            {formatNumberWithComma(totalItems - indexedItemCount)} more not loaded yet
          </Badge>
        ) : null}
      </div>
    </>
  );
}
