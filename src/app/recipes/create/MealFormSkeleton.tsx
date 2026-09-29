import { Skeleton } from '@/components/ui/skeleton'
import { BackToRecipesLinkSkeleton } from '@/components/recipes/BackToRecipesLink'

/**
 * The create and edit pages' placeholder: the route `loading.tsx` files and the
 * clients' own pending states render this, so the page never moves between
 * route loading, client pending and the loaded `MealForm` (HON-779). Same
 * container and `max-w-2xl` column as the pages, top-aligned, no bordered
 * wrapper. Bar heights match each rendered line box: title `h-7` in the back
 * arrow's `h-8` row (HON-822), description and section headings as `/profile`,
 * controls `h-touch md:h-10`.
 */
export function MealFormSkeleton() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex max-w-2xl flex-col gap-6">
        {/* Back arrow and title, then description */}
        <div className="flex flex-col gap-1">
          <div className="flex h-8 items-center gap-2">
            <BackToRecipesLinkSkeleton />
            <Skeleton className="h-7 w-36" />
          </div>
          <Skeleton className="h-5 w-64" />
        </div>

        {/* Basic information: section heading, name, description, servings */}
        <div className="flex flex-col gap-4">
          <Skeleton className="h-7 w-40" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-touch w-full md:h-10" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-16 w-full" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-touch w-full md:h-10" />
          </div>
        </div>
      </div>
    </div>
  )
}
