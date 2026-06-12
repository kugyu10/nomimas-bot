import { Skeleton } from "@/components/ui/skeleton";

export default function EventsLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      {/* Page header: title + CTA placeholder */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-32" aria-hidden="true" />
        <Skeleton className="h-9 w-36" aria-hidden="true" />
      </div>

      {/* Table header: 6 columns */}
      <div className="rounded-md border">
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" aria-hidden="true" />
            ))}
          </div>

          {/* Table rows: 5 rows */}
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" aria-hidden="true" />
          ))}
        </div>
      </div>
    </div>
  );
}
