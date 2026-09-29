import { Skeleton } from '@/components/ui/skeleton'

interface RecipesGridSkeletonProps {
  /** How many card placeholders to draw. */
  count?: number
}

/**
 * Placeholder for `MealList`'s grid: same columns and gap, one card-shaped
 * block per meal. Shared by `loading.tsx` and, from HON-770, the client's own
 * loading state, so the two cannot drift from the loaded grid separately.
 *
 * A loaded card is its content above a 3:2 image at the card's full width
 * (`MealImageCard layout="bottom"`), so its height follows the column width.
 * The placeholder takes its height from the same two parts rather than a fixed
 * `h-*`: `h-60` is the content with the card's border, `py-2` and `gap-2`
 * (234px for a one-line description, 258px for two, measured on the
 * `MealList` story), and the `aspect-3/2` block is the image. No ingredient
 * list: the library renders none (HON-819).
 */
export function RecipesGridSkeleton({ count = 6 }: RecipesGridSkeletonProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} shape="card" className="w-full">
          <div className="h-60" />
          <div className="aspect-3/2 w-full" />
        </Skeleton>
      ))}
    </div>
  )
}
