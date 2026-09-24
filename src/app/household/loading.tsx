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
            <Skeleton className="h-touch w-full md:h-10" />
            <Skeleton className="h-touch w-full md:h-10" />
            <Skeleton className="h-touch w-full md:h-10" />
          </div>
          {/* Save settings: full width on a phone, label-sized from md (HON-782) */}
          <Skeleton className="h-touch w-full md:h-10 md:w-28" />
        </div>

        {/* Right column: Members */}
        <div className="flex flex-col gap-6">
          <Skeleton className="h-7 w-28" />
          <div className="flex flex-col gap-3">
            <Skeleton shape="card" className="h-16 w-full" />
            <Skeleton shape="card" className="h-16 w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
