import { ChevronDown, FileCheck, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DownloadIntegrityMode, DownloadIntegrityReport } from "@/types/settings";

interface SettingsIntegritySectionProps {
  checkingIntegrity: boolean;
  checkingIntegrityMode: DownloadIntegrityMode | null;
  integrityPhase?: string;
  integrityReport: DownloadIntegrityReport | null;
  onCheckIntegrity: (mode: DownloadIntegrityMode) => void | Promise<void>;
  onCancelIntegrityCheck: () => void | Promise<void>;
}

export function SettingsIntegritySection({
  checkingIntegrity,
  checkingIntegrityMode,
  integrityPhase,
  integrityReport,
  onCheckIntegrity,
  onCancelIntegrityCheck,
}: SettingsIntegritySectionProps) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2">
        Download Integrity
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>
              Quick checks local completeness. Deep also validates tracked files against remote
              sizes.
            </p>
          </TooltipContent>
        </Tooltip>
      </Label>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              disabled={checkingIntegrity}
              data-testid="integrity-trigger"
            >
              {checkingIntegrity ? (
                <>
                  <Spinner />
                  {checkingIntegrityMode === "deep" ? "Deep Checking..." : "Quick Checking..."}
                </>
              ) : (
                <>
                  <FileCheck className="h-4 w-4" />
                  Check Current Folder
                  <ChevronDown className="h-4 w-4" />
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              disabled={checkingIntegrity}
              onClick={() => void onCheckIntegrity("quick")}
              data-testid="integrity-action-quick"
            >
              Quick Check
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={checkingIntegrity}
              onClick={() => void onCheckIntegrity("deep")}
              data-testid="integrity-action-deep"
            >
              Deep Check
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {checkingIntegrity ? (
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => void onCancelIntegrityCheck()}
            data-testid="integrity-cancel"
          >
            Cancel
          </Button>
        ) : null}
        {integrityReport ? (
          <span className="text-xs text-muted-foreground">
            Last {integrityReport.mode === "deep" ? "deep" : "quick"} scan:{" "}
            {integrityReport.partial_files + integrityReport.incomplete_files} issue(s),{" "}
            {integrityReport.checked_files} checked
          </span>
        ) : null}
      </div>
      {checkingIntegrity && integrityPhase ? (
        <p className="text-xs text-muted-foreground">
          Running phase: {integrityPhase}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Quick avoids remote checks. Deep is slower, but it can catch truncated tracked files.
      </p>
    </div>
  );
}
