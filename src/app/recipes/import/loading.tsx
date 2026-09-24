import { Skeleton } from '@/components/ui/skeleton'

// Mirrors `RecipeImportClient`: same container and `max-w-2xl` column,
// top-aligned, no bordered wrapper (HON-779).
export default function RecipeImportLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex max-w-2xl flex-col gap-6">
        {/* Back button and title, then description */}
        <div className="flex flex-col gap-1">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-5 w-64" />
        </div>

        {/* Textarea (12 rows) */}
        <Skeleton className="h-72 w-full" />

        {/* Submit button: full width on a phone, label-sized from md (HON-782) */}
        <Skeleton className="h-touch w-full md:h-10 md:w-32" />
      </div>
    </div>
  )
}
