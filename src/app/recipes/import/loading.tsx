import { Skeleton } from '@/components/ui/skeleton'

export default function RecipeImportLoading() {
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

          {/* Textarea */}
          <Skeleton className="mb-6 h-40 w-full rounded-md" />

          {/* Footer with button */}
          <div className="flex justify-end">
            <Skeleton className="h-touch w-28 rounded-md md:h-9" />
          </div>
        </div>
      </div>
    </div>
  )
}
