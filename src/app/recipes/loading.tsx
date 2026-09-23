import { Skeleton } from '@/components/ui/skeleton'

export default function RecipesLoading() {
  return (
    <div className="min-h-screen-below-header grid place-items-center p-4">
      <div className="w-full max-w-2xl rounded-lg border p-6">
        {/* Card header */}
        <div className="mb-6 flex flex-col gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-5 w-64" />
        </div>

        {/* Content */}
        <div className="flex flex-col gap-6">
          {/* Recipe count and button */}
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-touch w-32 md:h-10" />
          </div>

          {/* Loading area */}
          <div className="flex items-center justify-center py-12">
            <Skeleton shape="circle" className="h-6 w-6" />
          </div>
        </div>
      </div>
    </div>
  )
}
