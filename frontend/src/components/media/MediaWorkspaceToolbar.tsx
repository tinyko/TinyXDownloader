import { Download, Film, FolderOpen, Image, LayoutGrid, List, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MediaTypeCounts } from "@/types/api";
import type { MediaWorkspaceViewMode } from "@/types/media";
import { formatNumberWithComma } from "@/lib/media/utils";

interface MediaWorkspaceToolbarProps {
  fetchedMediaType: string;
  totalUrls: number;
  mediaCounts: MediaTypeCounts;
  sortBy: string;
  onSortByChange: (value: string) => void;
  filterType: string;
  onFilterTypeChange: (value: string) => void;
  viewMode: MediaWorkspaceViewMode;
  onViewModeChange: (value: MediaWorkspaceViewMode) => void;
  folderExists: boolean;
  ffmpegInstalled: boolean;
  gifsFolderHasMP4: boolean;
  isConverting: boolean;
  isDownloading: boolean;
  selectedCount: number;
  filteredCount: number;
  allFilteredSelected: boolean;
  onToggleSelectAll: () => void;
  onOpenFolder: () => void | Promise<void>;
  onConvertGifs: () => void | Promise<void>;
  onDownload: () => void | Promise<void>;
}

export function MediaWorkspaceToolbar({
  fetchedMediaType,
  totalUrls,
  mediaCounts,
  sortBy,
  onSortByChange,
  filterType,
  onFilterTypeChange,
  viewMode,
  onViewModeChange,
  folderExists,
  ffmpegInstalled,
  gifsFolderHasMP4,
  isConverting,
  isDownloading,
  selectedCount,
  filteredCount,
  allFilteredSelected,
  onToggleSelectAll,
  onOpenFolder,
  onConvertGifs,
  onDownload,
}: MediaWorkspaceToolbarProps) {
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
          </SelectContent>
        </Select>

        {fetchedMediaType === "all" ? (
          <Select value={filterType} onValueChange={onFilterTypeChange}>
            <SelectTrigger className="h-9 w-auto rounded-xl px-3 text-sm">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({formatNumberWithComma(totalUrls)})</SelectItem>
              {mediaCounts.photo > 0 ? (
                <SelectItem value="photo">
                  <span className="flex items-center gap-2">
                    <Image className="h-4 w-4 text-blue-500" />
                    Images ({formatNumberWithComma(mediaCounts.photo)})
                  </span>
                </SelectItem>
              ) : null}
              {mediaCounts.video > 0 ? (
                <SelectItem value="video">
                  <span className="flex items-center gap-2">
                    <Video className="h-4 w-4 text-purple-500" />
                    Videos ({formatNumberWithComma(mediaCounts.video)})
                  </span>
                </SelectItem>
              ) : null}
              {mediaCounts.gif > 0 ? (
                <SelectItem value="gif">
                  <span className="flex items-center gap-2">
                    <Film className="h-4 w-4 text-green-500" />
                    GIFs ({formatNumberWithComma(mediaCounts.gif)})
                  </span>
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        ) : null}

        <div className="flex items-center rounded-xl border">
          <Button
            variant={viewMode === "gallery" ? "secondary" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-r-none"
            onClick={() => onViewModeChange("gallery")}
            aria-label="Show gallery view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-l-none border-l"
            onClick={() => onViewModeChange("list")}
            aria-label="Show list view"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1" />
        <Button
          variant="outline"
          className="h-9 rounded-xl px-3 text-sm"
          onClick={onOpenFolder}
          disabled={!folderExists}
        >
          <FolderOpen className="h-4 w-4" />
          Open Folder
        </Button>
        <Button
          variant="outline"
          className="h-9 rounded-xl px-3 text-sm"
          onClick={onConvertGifs}
          disabled={isConverting || !gifsFolderHasMP4 || !ffmpegInstalled}
        >
          <Film className="h-4 w-4" />
          {isConverting ? "Converting..." : "Convert GIFs"}
        </Button>
        <Button
          className="h-9 rounded-xl px-3 text-sm"
          onClick={onDownload}
          disabled={isDownloading}
        >
          <Download className="h-4 w-4" />
          Download {selectedCount > 0 ? `${selectedCount}` : "All"}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox checked={allFilteredSelected} onCheckedChange={onToggleSelectAll} />
        <span className="text-xs text-muted-foreground">
          Select all ({formatNumberWithComma(filteredCount)} items)
        </span>
        {selectedCount > 0 ? (
          <Badge variant="secondary">{formatNumberWithComma(selectedCount)} selected</Badge>
        ) : null}
      </div>
    </>
  );
}
