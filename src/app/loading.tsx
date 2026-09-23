import { Skeleton } from '@/components/ui/skeleton'

export default function HomeLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="lg:grid-cols-timeline grid gap-6">
        {/* Left column: meals */}
        <div className="flex flex-col gap-6">
          {/* Today's meals heading */}
          <Skeleton className="h-8 w-40" />

          {/* Meal cards */}
          <div className="flex flex-col gap-4">
            <Skeleton shape="card" className="h-28 w-full" />
            <Skeleton shape="card" className="h-28 w-full" />
          </div>

          {/* Tomorrow preview heading */}
          <Skeleton className="h-7 w-48" />

          {/* Tomorrow meal cards */}
          <div className="flex flex-col gap-4">
            <Skeleton shape="card" className="h-28 w-full" />
          </div>
        </div>

        {/* Right column: shopping summary. Hidden below lg like the real
            sidebar (HON-766); no phone placeholder for the compact card, which
            renders nothing when there is nothing to buy. */}
        <div className="hidden flex-col gap-6 lg:flex">
          <Skeleton className="h-7 w-36" />
          <div className="flex flex-col gap-3">
            <Skeleton shape="card" className="h-10 w-full" />
            <Skeleton shape="card" className="h-10 w-full" />
            <Skeleton shape="card" className="h-10 w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
