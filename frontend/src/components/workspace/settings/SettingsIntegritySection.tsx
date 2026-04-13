import { FileCheck, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DownloadIntegrityReport } from "@/types/settings";

interface SettingsIntegritySectionProps {
  checkingIntegrity: boolean;
  integrityReport: DownloadIntegrityReport | null;
  onCheckIntegrity: () => void | Promise<void>;
}

export function SettingsIntegritySection({
  checkingIntegrity,
  integrityReport,
  onCheckIntegrity,
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
            <p>Checks leftover .part files and validates tracked media against remote file sizes</p>
          </TooltipContent>
        </Tooltip>
      </Label>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={onCheckIntegrity}
          disabled={checkingIntegrity}
        >
          {checkingIntegrity ? (
            <>
              <Spinner />
              Checking...
            </>
          ) : (
            <>
              <FileCheck className="h-4 w-4" />
              Check Current Folder
            </>
          )}
        </Button>
        {integrityReport ? (
          <span className="text-xs text-muted-foreground">
            Last scan: {integrityReport.partial_files + integrityReport.incomplete_files} issue(s),{" "}
            {integrityReport.checked_files} checked
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Files that are no longer in the database can be counted but may not be fully verifiable.
      </p>
    </div>
  );
}
