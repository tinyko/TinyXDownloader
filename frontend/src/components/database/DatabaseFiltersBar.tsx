import { ArrowUpDown, FileText, Filter, Film, Image, Images, LayoutGrid, List, Search, Tag, Video, XCircle } from "lucide-react";

import { formatNumberWithComma } from "@/lib/database/helpers";
import type {
  DatabaseGridView,
  DatabaseSortOrder,
  GroupInfo,
} from "@/types/database";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DatabaseFiltersBarProps {
  accountViewMode: "public" | "private";
  selectedCount: number;
  allVisibleSelected: boolean;
  onToggleSelectAll: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  filterGroup: string;
  onFilterGroupChange: (value: string) => void;
  filterMediaType: string;
  onFilterMediaTypeChange: (value: string) => void;
  sortOrder: DatabaseSortOrder;
  onSortOrderChange: (value: DatabaseSortOrder) => void;
  gridView: DatabaseGridView;
  onGridViewChange: (value: DatabaseGridView) => void;
  groups: GroupInfo[];
}

export function DatabaseFiltersBar({
  accountViewMode,
  selectedCount,
  allVisibleSelected,
  onToggleSelectAll,
  searchQuery,
  onSearchQueryChange,
  filterGroup,
  onFilterGroupChange,
  filterMediaType,
  onFilterMediaTypeChange,
  sortOrder,
  onSortOrderChange,
  gridView,
  onGridViewChange,
  groups,
}: DatabaseFiltersBarProps) {
  return (
    <>
      <div className="flex items-center gap-4 py-2">
        <div className="flex items-center gap-2">
          <Checkbox checked={allVisibleSelected} onCheckedChange={onToggleSelectAll} />
          <span className="text-sm text-muted-foreground">
            Select all {selectedCount > 0 && `(${formatNumberWithComma(selectedCount)} selected)`}
          </span>
        </div>

        {accountViewMode === "public" ? (
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              className="h-9 pl-9"
              data-testid="saved-search-input"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => onSearchQueryChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <XCircle className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 pb-2">
        {accountViewMode === "public" ? (
          <Select
            value={sortOrder}
            onValueChange={(value) => onSortOrderChange(value as DatabaseSortOrder)}
          >
            <SelectTrigger className="w-auto" data-testid="saved-sort-order-trigger">
              <ArrowUpDown className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="username-asc">Username (A-Z)</SelectItem>
              <SelectItem value="username-desc">Username (Z-A)</SelectItem>
              <SelectItem value="followers-high">Followers (High-Low)</SelectItem>
              <SelectItem value="followers-low">Followers (Low-High)</SelectItem>
              <SelectItem value="posts-high">Posts (High-Low)</SelectItem>
              <SelectItem value="posts-low">Posts (Low-High)</SelectItem>
              <SelectItem value="media-high">Media Count (High-Low)</SelectItem>
              <SelectItem value="media-low">Media Count (Low-High)</SelectItem>
            </SelectContent>
          </Select>
        ) : null}

        {accountViewMode === "public" ? (
          <Select value={filterMediaType} onValueChange={onFilterMediaTypeChange}>
            <SelectTrigger className="w-auto" data-testid="saved-media-filter-trigger">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="all-media">
                <span className="flex items-center gap-2">
                  <Images className="h-4 w-4 text-indigo-500" />
                  All Media
                </span>
              </SelectItem>
              <SelectItem value="image">
                <span className="flex items-center gap-2">
                  <Image className="h-4 w-4 text-blue-500" />
                  Images
                </span>
              </SelectItem>
              <SelectItem value="video">
                <span className="flex items-center gap-2">
                  <Video className="h-4 w-4 text-purple-500" />
                  Videos
                </span>
              </SelectItem>
              <SelectItem value="gif">
                <span className="flex items-center gap-2">
                  <Film className="h-4 w-4 text-green-500" />
                  GIFs
                </span>
              </SelectItem>
              <SelectItem value="text">
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-orange-500" />
                  Text
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        ) : null}

        {accountViewMode === "public" ? (
          <Select
            value={filterGroup}
            onValueChange={onFilterGroupChange}
            disabled={groups.length === 0}
          >
            <SelectTrigger className="w-auto" data-testid="saved-group-filter-trigger">
              <Tag className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Filter by group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Groups</SelectItem>
              <SelectItem value="ungrouped">Ungrouped</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group.name} value={group.name}>
                  <span className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: group.color }}
                    />
                    {group.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <div className="flex-1" />

        {accountViewMode === "public" ? (
          <div className="flex items-center rounded-md border">
            <Button
              variant={gridView === "gallery" ? "secondary" : "ghost"}
              size="icon"
              className="h-10 w-10 rounded-r-none"
              onClick={() => onGridViewChange("gallery")}
              aria-label="Show gallery view"
              data-testid="saved-view-gallery"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={gridView === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-10 w-10 rounded-l-none border-l"
              onClick={() => onGridViewChange("list")}
              aria-label="Show list view"
              data-testid="saved-view-list"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
