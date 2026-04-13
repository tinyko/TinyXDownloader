import type { ReactNode } from "react";

interface FetchWorkspaceLayoutProps {
  sidebar: ReactNode;
  workspace: ReactNode;
  activityPanel: ReactNode;
}

export function FetchWorkspaceLayout({
  sidebar,
  workspace,
  activityPanel,
}: FetchWorkspaceLayoutProps) {
  return (
    <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)_340px]">
      <section
        className="min-h-0 min-w-0 overflow-y-auto pr-1"
        aria-label="Fetch controls"
      >
        {sidebar}
      </section>

      <section
        className="min-h-0 min-w-0 overflow-hidden rounded-[28px] border border-border/70 bg-card/40 p-5 shadow-sm"
        aria-label="Fetch results"
      >
        {workspace}
      </section>

      <section
        className="min-h-0 min-w-0 overflow-hidden"
        aria-label="Activity panel"
      >
        {activityPanel}
      </section>
    </div>
  );
}
