import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DownloadIntegrityReport } from "@/types/settings";

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatIntegrityReason(reason: string): string {
  switch (reason) {
    case "partial_file":
      return "Leftover partial file";
    case "size_mismatch":
      return "Local file is smaller than remote file";
    case "empty_text_file":
      return "Text export is empty";
    case "empty_file":
      return "Downloaded file is empty";
    case "missing_file":
      return "Tracked file is missing on disk";
    default:
      return reason.replace(/_/g, " ");
  }
}

interface IntegrityReportDialogProps {
  report: DownloadIntegrityReport | null;
  fallbackDownloadPath: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onOpenFolder: () => void | Promise<void>;
}

export function IntegrityReportDialog({
  report,
  fallbackDownloadPath,
  open,
  onOpenChange,
  onOpenFolder,
}: IntegrityReportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Download Integrity Report</DialogTitle>
          <DialogDescription>
            {report?.mode === "deep" ? "Deep check" : "Quick check"} inspected{" "}
            {report?.checked_files ?? 0} tracked file(s) under{" "}
            {report?.download_path || fallbackDownloadPath}
          </DialogDescription>
        </DialogHeader>

        {report ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ["Scanned", report.scanned_files],
                ["Checked", report.checked_files],
                ["Incomplete", report.incomplete_files],
                ["Partial", report.partial_files],
                ["Complete", report.complete_files],
                ["Untracked", report.untracked_files],
                ["Unverifiable", report.unverifiable_files],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="text-lg font-semibold">{value}</div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border p-3 text-xs text-muted-foreground">
              {report.mode === "deep"
                ? "Deep check included remote file size validation where the origin exposed a size."
                : "Quick check stayed local and did not request remote file sizes."}
            </div>

            {report.issues.length > 0 ? (
              <div className="space-y-2">
                <div className="text-sm font-medium">Problems Found</div>
                <div className="max-h-[360px] overflow-y-auto rounded-lg border">
                  {report.issues.map((issue) => (
                    <div
                      key={`${issue.relative_path}-${issue.reason}`}
                      className="border-b p-3 last:border-b-0"
                    >
                      <div className="break-all font-mono text-xs">{issue.relative_path}</div>
                      <div className="mt-1 text-sm">{formatIntegrityReason(issue.reason)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Local: {formatBytes(issue.local_size)}
                        {issue.remote_size > 0
                          ? ` • Remote: ${formatBytes(issue.remote_size)}`
                          : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border p-4 text-sm text-green-600 dark:text-green-400">
                No incomplete files found in the tracked media set.
              </div>
            )}

            {report.untracked_files > 0 || report.unverifiable_files > 0 ? (
              <div className="rounded-lg border p-3 text-xs text-muted-foreground">
                {report.untracked_files > 0 ? (
                  <div>
                    {report.untracked_files} file(s) could not be matched back to saved database
                    entries.
                  </div>
                ) : null}
                {report.unverifiable_files > 0 ? (
                  <div>
                    {report.unverifiable_files} tracked file(s) could not be verified because
                    remote size was unavailable.
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onOpenFolder}>
            Open Folder
          </Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
