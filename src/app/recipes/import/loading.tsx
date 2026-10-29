import { BackToRecipesLinkSkeleton } from '@/components/recipes/BackToRecipesLink'
import { Skeleton } from '@/components/ui/skeleton'

// Mirrors `RecipeImportClient`: same container and centred `max-w-2xl` column,
// top-aligned, no bordered wrapper (HON-779).
export default function RecipeImportLoading() {
  return (
    <div className="w-full px-4 py-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        {/* Back arrow and title, then description */}
        <div className="flex flex-col gap-1">
          <div className="flex h-8 items-center gap-2">
            <BackToRecipesLinkSkeleton />
            <Skeleton className="h-7 w-44" />
          </div>
          <Skeleton className="h-5 w-64" />
        </div>

        {/* Textarea (12 rows) */}
        <Skeleton className="h-72 w-full" />

        {/* Submit, then "Start from a blank recipe": full width on a phone,
            label-sized from md (HON-782, HON-1271) */}
        <div className="flex flex-col gap-3">
          <Skeleton className="h-touch w-full md:h-10 md:w-32" />
          <Skeleton className="h-touch w-full md:h-10 md:w-56" />
        </div>
      </div>
    </div>
  )
}
