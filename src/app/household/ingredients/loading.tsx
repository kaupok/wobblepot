import { IngredientRowSkeleton } from '@/components/household/HouseholdIngredientList'
import { Skeleton } from '@/components/ui/skeleton'

// Mirrors `page.tsx` only: the "Household" title and the tabs are the
// layout's, which stays on screen while this shows (HON-1257).
export default function HouseholdIngredientsLoading() {
  return (
    <div className="flex flex-col gap-4">
      {/* The Section heading, then two rows */}
      <Skeleton className="h-6 w-48" />
      <div className="flex flex-col divide-y">
        <IngredientRowSkeleton />
        <IngredientRowSkeleton />
      </div>
    </div>
  )
}
