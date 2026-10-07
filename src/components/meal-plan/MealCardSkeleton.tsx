import { Skeleton } from '@/components/ui/skeleton'

/**
 * A planned `MealCard` while Today loads, at the card's height for a name of
 * two lines or fewer, so the page does not jump when the data arrives
 * (HON-1096): 156px on a narrow card, 204px from 448px, where the card adds
 * two description lines. The switch is the card's own container query
 * (`@md/meal-image`), so the wrapper is the container and the skeleton takes
 * its width. The heights are the card's rows added up (`MealCard`, the text
 * block's comment); `Meal plan/MealCard` → `One height per breakpoint`
 * measures the two side by side. No 'use client': `src/app/loading.tsx` is a
 * server component.
 */
export function MealCardSkeleton() {
  return (
    <div className="@container">
      <Skeleton shape="card" className="h-39 w-full @md:h-51" />
    </div>
  )
}
