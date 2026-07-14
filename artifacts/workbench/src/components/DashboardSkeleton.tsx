import { Skeleton } from "@/components/ui/skeleton";

function TopicCardSkeleton() {
  return (
    <div className="bg-card border border-border p-4 rounded-sm h-full flex flex-col gap-3">
      <div className="flex justify-between items-start gap-3">
        <Skeleton className="h-5 w-28" />
        <div className="space-y-1.5 text-right">
          <Skeleton className="h-7 w-10 ml-auto" />
          <Skeleton className="h-2.5 w-16 ml-auto" />
        </div>
      </div>
      <div className="border-t border-border/50 pt-2 space-y-2">
        <div className="flex justify-between items-center">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-4 w-6" />
        </div>
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-2 w-14 ml-auto" />
      </div>
      <div className="mt-auto pt-2 border-t border-border/50 space-y-1.5">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-2.5 w-20" />
      </div>
    </div>
  );
}

function IncidentRowSkeleton() {
  return (
    <div className="p-4 flex justify-between items-start gap-4">
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-4 w-4/5" />
      </div>
      <Skeleton className="h-4 w-4 shrink-0 mt-1" />
    </div>
  );
}

function SidePanelSkeleton({ headerTone = "sidebar" }: { headerTone?: "sidebar" | "muted" }) {
  return (
    <div className="bg-card border border-border rounded-sm flex flex-col overflow-hidden">
      <div
        className={
          headerTone === "sidebar"
            ? "p-4 border-b border-border bg-sidebar"
            : "p-4 border-b border-border bg-muted/50"
        }
      >
        <Skeleton
          className={
            headerTone === "sidebar" ? "h-4 w-36 bg-sidebar-foreground/20" : "h-4 w-40"
          }
        />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="p-4 space-y-2">
            <div className="flex justify-between gap-3">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-4 w-12" />
            </div>
            <Skeleton className="h-3 w-2/5" />
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-border bg-muted/10 flex justify-center">
        <Skeleton className="h-3 w-28" />
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="max-w-[1600px] mx-auto space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="flex items-end justify-between mb-2">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-52" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border p-px rounded-sm overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-card p-4 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-12" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-5 w-36" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <TopicCardSkeleton key={i} />
            ))}
          </div>

          <div className="flex items-center gap-2 border-b border-border pb-2 mt-8">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-5 w-48" />
          </div>

          <div className="bg-card border border-border rounded-sm overflow-hidden divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <IncidentRowSkeleton key={i} />
            ))}
            <div className="p-3 bg-muted/30 border-t border-border flex justify-center">
              <Skeleton className="h-3.5 w-28" />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <SidePanelSkeleton headerTone="sidebar" />
          <SidePanelSkeleton headerTone="muted" />
        </div>
      </div>
    </div>
  );
}
