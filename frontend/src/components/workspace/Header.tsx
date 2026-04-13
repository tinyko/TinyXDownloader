import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsIcon } from "@/components/workspace/SettingsIcon";
import { APP_NAME } from "@/lib/app-info";
import { Activity } from "lucide-react";

type WorkspaceTab = "fetch" | "saved";

interface HeaderProps {
  version: string;
  onOpenDiagnostics: () => void;
  onOpenSettings: () => void;
  workspaceTab: WorkspaceTab;
  onWorkspaceTabChange: (tab: WorkspaceTab) => void;
}

export function Header({
  version,
  onOpenDiagnostics,
  onOpenSettings,
  workspaceTab,
  onWorkspaceTabChange,
}: HeaderProps) {
  return (
    <div className="relative">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-4">
              <img
                src="/icon.svg"
                alt={APP_NAME}
                className="h-14 w-14 rounded-2xl"
              />
              <div className="min-w-0 text-left">
                <h1 className="text-4xl font-bold tracking-tight">
                  {APP_NAME}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Desktop workspace for fetch, library review, and download tracking
                </p>
              </div>
            </div>
            <Badge variant="default">v{version}</Badge>
            <div className="inline-flex rounded-xl border bg-muted/60 p-1">
              <Button
                variant={workspaceTab === "fetch" ? "secondary" : "ghost"}
                className="h-10 min-w-0 rounded-lg px-4 text-xs leading-none sm:px-5 sm:text-[13px]"
                onClick={() => onWorkspaceTabChange("fetch")}
              >
                <span className="truncate">Fetch</span>
              </Button>
              <Button
                variant={workspaceTab === "saved" ? "secondary" : "ghost"}
                className="h-10 min-w-0 rounded-lg px-4 text-xs leading-none sm:px-5 sm:text-[13px]"
                onClick={() => onWorkspaceTabChange("saved")}
              >
                <span className="truncate">Saved Accounts</span>
              </Button>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            className="h-10 gap-2 rounded-xl px-4"
            onClick={onOpenDiagnostics}
          >
            <Activity className="h-[18px] w-[18px]" />
            Diagnostics
          </Button>
          <Button variant="outline" className="h-10 gap-2 rounded-xl px-4" onClick={onOpenSettings}>
            <SettingsIcon size={18} />
            Settings
          </Button>
        </div>
      </div>
    </div>
  );
}
