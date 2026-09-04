import { Skeleton } from '@/components/ui/skeleton'

export default function SignUpLoading() {
  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <div className="w-full max-w-md rounded-lg border p-6">
        {/* Card header */}
        <div className="mb-6 flex flex-col gap-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-56" />
        </div>

        {/* Form fields */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-touch w-full rounded-md md:h-9" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-touch w-full rounded-md md:h-9" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-touch w-full rounded-md md:h-9" />
          </div>
        </div>

        {/* Submit button */}
        <div className="mt-6">
          <Skeleton className="h-touch w-full rounded-md md:h-9" />
        </div>
      </div>
    </div>
  )
}
