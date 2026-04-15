import { useCallback, useState } from "react";

type WorkspaceTab = "fetch" | "saved" | "history";

export function useWorkspaceChromeState() {
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("fetch");
  const [savedTabVisited, setSavedTabVisited] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleWorkspaceTabChange = useCallback(
    (nextTab: WorkspaceTab) => {
      setWorkspaceTab(nextTab);
      if (nextTab === "saved") {
        setSavedTabVisited(true);
      }
    },
    []
  );

  return {
    workspaceTab,
    setWorkspaceTab: handleWorkspaceTabChange,
    savedTabVisited,
    diagnosticsOpen,
    setDiagnosticsOpen,
    settingsOpen,
    setSettingsOpen,
  };
}
