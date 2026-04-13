import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

interface WorkspaceDrawersProps {
  diagnosticsOpen: boolean;
  onDiagnosticsOpenChange: (open: boolean) => void;
  diagnosticsContent: ReactNode;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  settingsContent: ReactNode;
}

export function WorkspaceDrawers({
  diagnosticsOpen,
  onDiagnosticsOpenChange,
  diagnosticsContent,
  settingsOpen,
  onSettingsOpenChange,
  settingsContent,
}: WorkspaceDrawersProps) {
  return (
    <>
      <Dialog open={diagnosticsOpen} onOpenChange={onDiagnosticsOpenChange}>
        <DialogContent className="left-auto right-0 top-0 h-full w-full max-w-[min(100vw,44rem)] translate-x-0 translate-y-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-[44rem]">
          <DialogTitle className="sr-only">Diagnostics</DialogTitle>
          <div className="flex h-full min-h-0 flex-col overflow-hidden px-5 pb-5 pr-14 pt-5">
            {diagnosticsContent}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={onSettingsOpenChange}>
        <DialogContent className="left-auto right-0 top-0 h-full w-full max-w-[min(100vw,48rem)] translate-x-0 translate-y-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-[48rem]">
          <DialogTitle className="sr-only">Settings</DialogTitle>
          <div className="h-full overflow-y-auto px-5 pb-5 pr-14 pt-5">
            {settingsContent}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
