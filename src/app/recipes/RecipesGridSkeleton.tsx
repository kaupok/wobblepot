import { Skeleton } from '@/components/ui/skeleton'

interface RecipesGridSkeletonProps {
  /** How many card placeholders to draw. */
  count?: number
}

/**
 * Placeholder for `MealList`'s grid: same columns and gap, one card-shaped
 * block per meal. Shared by `loading.tsx` and, from HON-770, the client's own
 * loading state, so the two cannot drift from the loaded grid separately.
 */
export function RecipesGridSkeleton({ count = 6 }: RecipesGridSkeletonProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} shape="card" className="h-96 w-full" />
      ))}
    </div>
  )
}
