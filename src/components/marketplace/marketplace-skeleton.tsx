import { Skeleton } from "@/components/ui/skeleton";

export function MarketplaceSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-3 pt-3 lg:h-[calc(100dvh-96px)] lg:px-6 lg:pb-5" aria-busy="true">
      <span className="sr-only">Loading properties</span>
      <div className="flex gap-2">
        <Skeleton className="h-10 flex-1 lg:max-w-xs" />
        <Skeleton className="hidden h-10 flex-1 lg:block" />
        <Skeleton className="h-10 w-36" />
      </div>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[400px_1fr] xl:grid-cols-[440px_1fr]">
        <div className="hidden flex-col gap-3 lg:flex">
          <Skeleton className="h-14" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
        <Skeleton className="h-[calc(100dvh-260px)] min-h-[420px] rounded-3xl lg:h-auto" />
      </div>
    </div>
  );
}
