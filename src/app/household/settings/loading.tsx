import { Skeleton } from '@/components/ui/skeleton'

function FieldSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-touch w-full md:h-10" />
    </div>
  )
}

// Mirrors `page.tsx` only: the "Household" title and the tabs are the
// layout's, which stays on screen while this shows (HON-1257).
export default function HouseholdSettingsLoading() {
  return (
    <div className="flex flex-col gap-10">
      {/* Household details: name, timezone, language. No Save block: the
          button shows only once a field changes (HON-961). */}
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-40" />
        <FieldSkeleton />
        <FieldSkeleton />
        <FieldSkeleton />
      </div>

      {/* Separator, then Leave household: heading, one line, the button */}
      <div className="flex flex-col gap-6">
        <Skeleton className="h-px w-full" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-5 w-full max-w-md" />
          <Skeleton className="h-touch w-full md:h-10 md:w-40" />
        </div>
      </div>
    </div>
  )
}
