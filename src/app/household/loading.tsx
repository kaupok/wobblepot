import { Skeleton } from '@/components/ui/skeleton'

export default function HouseholdLoading() {
  return (
    <div className="container mx-auto flex flex-col gap-6 px-4 py-8">
      {/* Heading — h-7 matches the text-xl page title (HON-618) */}
      <Skeleton className="h-7 w-24" />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left column: Household settings */}
        <div className="flex flex-col gap-6">
          <Skeleton className="h-7 w-40" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-touch w-full rounded-md md:h-9" />
            <Skeleton className="h-touch w-full rounded-md md:h-9" />
            <Skeleton className="h-touch w-full rounded-md md:h-9" />
          </div>
          <Skeleton className="h-touch w-24 rounded-md md:h-9" />
        </div>

        {/* Right column: Members */}
        <div className="flex flex-col gap-6">
          <Skeleton className="h-7 w-28" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
