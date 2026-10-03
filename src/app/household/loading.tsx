import { Skeleton } from '@/components/ui/skeleton'

function MemberRowSkeleton() {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-1.5">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-5 w-20" />
    </div>
  )
}

function FieldSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-touch w-full md:h-10" />
    </div>
  )
}

export default function HouseholdLoading() {
  return (
    <div className="flex w-full flex-col gap-6 px-4 py-8">
      {/* Heading — h-7 matches the text-xl page title (HON-618) */}
      <Skeleton className="h-7 w-24" />

      {/* The page's order (HON-960) and width (HON-1020): the member list,
          then the settings' three sections, in one max-w-2xl column. */}
      <div className="flex max-w-2xl flex-col gap-10">
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

        {[3, 4, 2].map((fields, section) => (
          <div key={section} className="flex flex-col gap-4">
            <Skeleton className="h-6 w-40" />
            {Array.from({ length: fields }, (_, i) => (
              <FieldSkeleton key={i} />
            ))}
          </div>
        ))}
        {/* No Save block: each section's button shows only once a field
            in it changes (HON-961). */}
      </div>
    </div>
  )
}
