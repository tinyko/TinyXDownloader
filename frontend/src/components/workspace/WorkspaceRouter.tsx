import type { ReactNode } from "react";

type WorkspaceTab = "fetch" | "saved";

interface WorkspaceRouterProps {
  workspaceTab: WorkspaceTab;
  savedTabVisited: boolean;
  fetchView: ReactNode;
  savedView: ReactNode;
}

export function WorkspaceRouter({
  workspaceTab,
  savedTabVisited,
  fetchView,
  savedView,
}: WorkspaceRouterProps) {
  return (
    <>
      {workspaceTab === "fetch" ? fetchView : null}
      {savedTabVisited && workspaceTab === "saved" ? savedView : null}
    </>
  );
}
