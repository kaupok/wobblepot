import { Skeleton } from '@/components/ui/skeleton'

export default function OnboardingLoading() {
  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <div className="w-full max-w-md rounded-lg border p-6">
        {/* Card header */}
        <div className="mb-6 flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>

        {/* Form fields */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          <div className="flex flex-col gap-1">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        </div>

        {/* Submit button */}
        <div className="mt-6">
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      </div>
    </div>
  )
}
