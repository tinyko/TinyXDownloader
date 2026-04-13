import { useEffect, useState } from "react";

type WorkspaceTab = "fetch" | "saved";

export function useWorkspaceChromeState() {
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("fetch");
  const [savedTabVisited, setSavedTabVisited] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (workspaceTab === "saved") {
      setSavedTabVisited(true);
    }
  }, [workspaceTab]);

  return {
    workspaceTab,
    setWorkspaceTab,
    savedTabVisited,
    diagnosticsOpen,
    setDiagnosticsOpen,
    settingsOpen,
    setSettingsOpen,
  };
}
