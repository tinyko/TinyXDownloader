export function WorkspaceLoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[420px] items-center justify-center rounded-[24px] border border-dashed border-border/80 bg-muted/20 px-8 text-center">
      <div className="space-y-3">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        <p className="text-sm text-muted-foreground">Loading {label}...</p>
      </div>
    </div>
  );
}
