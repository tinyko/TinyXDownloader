import { CloudBackup, Download, FileBraces, FileInput, FileOutput, FileText, Globe, Lock, StopCircle, Trash2, X } from "lucide-react";

import { formatNumberWithComma } from "@/lib/database/helpers";
import type { DatabaseAccountViewMode } from "@/types/database";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface DatabaseHeaderBarProps {
  accountViewMode: DatabaseAccountViewMode;
  onAccountViewModeChange: (value: DatabaseAccountViewMode) => void;
  publicCount: number;
  privateCount: number;
  selectedCount: number;
  hasPrivateAccountSelected: boolean;
  isBulkDownloading: boolean;
  isDownloading: boolean;
  clearAllDialogOpen: boolean;
  onClearAllDialogOpenChange: (open: boolean) => void;
  onImport: () => void;
  onExportJSON: () => void | Promise<void>;
  onExportTXT: () => void | Promise<void>;
  onUpdateSelected: () => void | Promise<void>;
  onBulkDownload: () => void | Promise<void>;
  onStopBulkDownload: () => void | Promise<void>;
  onDeleteSelected: () => void | Promise<void>;
}

export function DatabaseHeaderBar({
  accountViewMode,
  onAccountViewModeChange,
  publicCount,
  privateCount,
  selectedCount,
  hasPrivateAccountSelected,
  isBulkDownloading,
  isDownloading,
  clearAllDialogOpen,
  onClearAllDialogOpenChange,
  onImport,
  onExportJSON,
  onExportTXT,
  onUpdateSelected,
  onBulkDownload,
  onStopBulkDownload,
  onDeleteSelected,
}: DatabaseHeaderBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold">Saved Accounts</h2>
        <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
          <button
            type="button"
            onClick={() => onAccountViewModeChange("public")}
            data-testid="saved-account-view-public"
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all ${
              accountViewMode === "public"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Globe className="h-3 w-3" />
            Public ({formatNumberWithComma(publicCount)})
          </button>
          <button
            type="button"
            onClick={() => onAccountViewModeChange("private")}
            data-testid="saved-account-view-private"
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all ${
              accountViewMode === "private"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Lock className="h-3 w-3" />
            Private ({formatNumberWithComma(privateCount)})
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" onClick={onImport}>
              <FileInput className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Import JSON</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" disabled={selectedCount === 0}>
                  <FileOutput className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              Export Selected ({formatNumberWithComma(selectedCount)})
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void onExportJSON()}>
              <FileBraces className="mr-2 h-4 w-4" />
              Export JSON
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void onExportTXT()}
              disabled={hasPrivateAccountSelected}
            >
              <FileText className="mr-2 h-4 w-4" />
              Export TXT
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void onUpdateSelected()}
              disabled={selectedCount === 0 || hasPrivateAccountSelected}
            >
              <CloudBackup className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Update Selected ({formatNumberWithComma(selectedCount)})
          </TooltipContent>
        </Tooltip>

        {isBulkDownloading ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={() => void onStopBulkDownload()}>
                <StopCircle className="h-4 w-4 text-destructive" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Stop Bulk Download</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="icon"
                onClick={() => void onBulkDownload()}
                disabled={selectedCount === 0 || isDownloading}
              >
                <Download className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Download Selected ({formatNumberWithComma(selectedCount)})
            </TooltipContent>
          </Tooltip>
        )}

        <Dialog
          open={clearAllDialogOpen}
          onOpenChange={onClearAllDialogOpenChange}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="icon"
                  disabled={selectedCount === 0}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent>
              Delete Selected ({formatNumberWithComma(selectedCount)})
            </TooltipContent>
          </Tooltip>
          <DialogContent className="[&>button]:hidden">
            <div className="absolute right-4 top-4">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-70 hover:opacity-100"
                onClick={() => onClearAllDialogOpenChange(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <DialogHeader>
              <DialogTitle>
                Delete {formatNumberWithComma(selectedCount)} Selected Account
                {selectedCount !== 1 ? "s" : ""}?
              </DialogTitle>
              <DialogDescription>
                This will permanently delete the selected account
                {selectedCount !== 1 ? "s" : ""}. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="destructive" onClick={() => void onDeleteSelected()}>
                Delete {formatNumberWithComma(selectedCount)} Account
                {selectedCount !== 1 ? "s" : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
