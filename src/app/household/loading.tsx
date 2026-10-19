import { Skeleton } from '@/components/ui/skeleton'

function MemberRowSkeleton() {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-1.5">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-5 w-20" />
    </div>
  )
}

// Mirrors `page.tsx` only: the "Household" title and the tabs are the
// layout's, which stays on screen while this shows (HON-1257).
export default function HouseholdMembersLoading() {
  return (
    <div className="flex flex-col gap-4">
      {/* Members title row: the Section heading, Add member on its right */}
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-touch w-32 md:h-10" />
      </div>
      <div className="flex flex-col divide-y">
        <MemberRowSkeleton />
        <MemberRowSkeleton />
      </div>
    </div>
  )
}
