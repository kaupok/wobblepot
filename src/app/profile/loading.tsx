import { Skeleton } from '@/components/ui/skeleton'

export default function ProfileLoading() {
  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <div className="w-full max-w-md rounded-lg border p-6">
        {/* Card header */}
        <div className="mb-6 flex flex-col gap-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-4 w-48" />
        </div>

        {/* Profile fields */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-5 w-36" />
          </div>
          <div className="flex flex-col gap-1">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-5 w-48" />
          </div>
        </div>

        {/* Separator */}
        <Skeleton className="my-6 h-px w-full" />

        {/* Danger zone */}
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-touch w-32 rounded-md md:h-9" />
        </div>
      </div>
    </div>
  )
}
