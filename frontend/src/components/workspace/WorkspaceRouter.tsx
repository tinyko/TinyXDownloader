import type { ReactNode } from "react";

type WorkspaceTab = "fetch" | "saved" | "history";

interface WorkspaceRouterProps {
  workspaceTab: WorkspaceTab;
  savedTabVisited: boolean;
  fetchView: ReactNode;
  savedView: ReactNode;
  historyView: ReactNode;
}

export function WorkspaceRouter({
  workspaceTab,
  savedTabVisited,
  fetchView,
  savedView,
  historyView,
}: WorkspaceRouterProps) {
  return (
    <>
      {workspaceTab === "fetch" ? fetchView : null}
      {savedTabVisited && workspaceTab === "saved" ? savedView : null}
      {workspaceTab === "history" ? historyView : null}
    </>
  );
}
