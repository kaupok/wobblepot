import { Skeleton } from '@/components/ui/skeleton'

// Card blocks mirror the `Card` primitive's geometry (`gap-6 rounded-xl border
// p-6 shadow-sm`) and the text skeletons mirror the line heights they stand in
// for (`h2` → text-3xl → h-9, `h4` → text-xl → h-7.5, `Body variant="muted"` →
// text-sm → h-6, all at the HON-686 scale), so the swap to the real page shifts
// as little as possible.
export default function AdminSignupCodesLoading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      {/* Page heading + description */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-2/3" />
      </div>

      <div className="flex flex-col gap-6">
        {/* "Mint a new code" card */}
        <div className="flex flex-col gap-6 rounded-xl border p-6 shadow-sm">
          <Skeleton className="h-7.5 w-44" />
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-touch w-full rounded-md md:h-10" />
            </div>
            <Skeleton className="h-touch w-32 rounded-md md:h-10" />
          </div>
        </div>

        {/* "Existing codes" card */}
        <div className="flex flex-col gap-6 rounded-xl border p-6 shadow-sm">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7.5 w-36" />
            <Skeleton className="h-6 w-72" />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        </div>
      </div>
    </div>
  )
}
