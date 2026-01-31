import { Skeleton } from '@/components/ui/skeleton'

export default function ShoppingLoading() {
  return (
    <div className="container mx-auto max-w-6xl p-4">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Pantry section */}
        <div className="order-2 md:order-1">
          <Skeleton className="mb-4 h-7 w-24" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        </div>

        {/* Shopping section */}
        <div className="order-1 md:order-2">
          <Skeleton className="mb-4 h-7 w-32" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
