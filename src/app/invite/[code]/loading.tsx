import { Skeleton } from '@/components/ui/skeleton'

export default function InviteLoading() {
  return (
    <div className="min-h-screen-below-header grid place-items-center p-4">
      <div className="w-full max-w-md rounded-lg border p-6">
        {/* Card header */}
        <div className="mb-6 flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-5 w-56" />
        </div>

        {/* Invite details */}
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-36" />
        </div>

        {/* Action button */}
        <div className="mt-6">
          <Skeleton className="h-touch w-full md:h-10" />
        </div>
      </div>
    </div>
  )
}
