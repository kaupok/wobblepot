import { Skeleton } from '@/components/ui/skeleton'

export default function CreateRecipeLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mx-auto max-w-2xl">
        {/* Card */}
        <div className="rounded-lg border p-6">
          {/* Card header */}
          <div className="mb-6 flex flex-col gap-2">
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-4 w-64" />
          </div>

          {/* Form fields */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-touch w-full rounded-md md:h-9" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-24 w-full rounded-md" />
            </div>
          </div>

          {/* Footer with button */}
          <div className="mt-6 flex justify-end">
            <Skeleton className="h-touch w-28 rounded-md md:h-9" />
          </div>
        </div>
      </div>
    </div>
  )
}
