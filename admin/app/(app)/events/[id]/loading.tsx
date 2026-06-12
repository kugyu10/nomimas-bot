import { Skeleton } from "@/components/ui/skeleton";

export default function EventDetailLoading() {
  return (
    <div className="space-y-4 p-6" aria-busy="true">
      {/* Title area */}
      <Skeleton className="h-7 w-48" aria-hidden="true" />
      {/* Subtitle */}
      <Skeleton className="h-4 w-24" aria-hidden="true" />

      {/* Tab row: 3 tabs */}
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-20" aria-hidden="true" />
        ))}
      </div>

      {/* Table body: 4 rows */}
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}
