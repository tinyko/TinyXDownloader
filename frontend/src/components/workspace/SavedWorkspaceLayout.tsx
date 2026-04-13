import type { ReactNode } from "react";

interface SavedWorkspaceLayoutProps {
  library: ReactNode;
  activityPanel: ReactNode;
}

export function SavedWorkspaceLayout({
  library,
  activityPanel,
}: SavedWorkspaceLayoutProps) {
  return (
    <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section
        className="min-h-0 min-w-0 overflow-hidden rounded-[28px] border border-border/70 bg-card/40 p-5 shadow-sm"
        aria-label="Saved accounts library"
      >
        {library}
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
