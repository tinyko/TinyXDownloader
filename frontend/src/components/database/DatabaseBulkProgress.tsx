import { Progress } from "@/components/ui/progress";

interface DatabaseBulkProgressProps {
  current: number;
  total: number;
}

export function DatabaseBulkProgress({
  current,
  total,
}: DatabaseBulkProgressProps) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="space-y-2 rounded-lg bg-muted/50 px-4 py-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Downloading account {current} of {total}
        </span>
        <span className="font-medium">{percent}%</span>
      </div>
      <Progress value={percent} className="h-2" />
    </div>
  );
}
