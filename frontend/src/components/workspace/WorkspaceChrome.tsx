import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { TitleBar } from "@/components/workspace/TitleBar";
import { Header } from "@/components/workspace/Header";

type WorkspaceTab = "fetch" | "saved" | "history";

interface WorkspaceChromeProps {
  version: string;
  workspaceTab: WorkspaceTab;
  onWorkspaceTabChange: (tab: WorkspaceTab) => void;
  onOpenDiagnostics: () => void;
  onOpenSettings: () => void;
  children: ReactNode;
  drawers?: ReactNode;
}

export function WorkspaceChrome({
  version,
  workspaceTab,
  onWorkspaceTabChange,
  onOpenDiagnostics,
  onOpenSettings,
  children,
  drawers,
}: WorkspaceChromeProps) {
  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <TitleBar />

        <div className="mt-10 h-[calc(100vh-2.5rem)] w-full overflow-hidden px-4 py-4 md:px-6 md:py-6 xl:px-8">
          <div className="flex h-full min-h-0 flex-col gap-6">
            <Header
              version={version}
              onOpenDiagnostics={onOpenDiagnostics}
              onOpenSettings={onOpenSettings}
              workspaceTab={workspaceTab}
              onWorkspaceTabChange={onWorkspaceTabChange}
            />
            {children}
          </div>
        </div>

        {drawers}
      </div>
    </TooltipProvider>
  );
}
