import { Skeleton } from "@/components/ui/skeleton";

export default function OaSettingsLoading() {
  return (
    <div className="space-y-4 p-6" aria-busy="true">
      {/* Page title */}
      <Skeleton className="h-7 w-24" aria-hidden="true" />

      {/* Card 1 */}
      <Skeleton className="rounded-lg h-48 w-full" aria-hidden="true" />

      {/* Card 2 */}
      <Skeleton className="rounded-lg h-40 w-full" aria-hidden="true" />

      {/* Card 3 (質問設定は背が高い) */}
      <Skeleton className="rounded-lg h-64 w-full" aria-hidden="true" />
    </div>
  );
}
