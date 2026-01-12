import { Skeleton } from '@/components/ui/skeleton'

export function InviteCardSkeleton() {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-3">
        {/* Badge and usage count row */}
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-4 w-16" />
        </div>

        {/* Input and copy button row */}
        <div className="flex gap-2">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-16" />
        </div>

        {/* Expiry text and revoke button row */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
    </div>
  )
}
