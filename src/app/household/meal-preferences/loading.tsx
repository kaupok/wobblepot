import { Skeleton } from '@/components/ui/skeleton'

function FieldSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-touch w-full md:h-10" />
    </div>
  )
}

// Mirrors `page.tsx` only: the "Household" title and the tabs are the
// layout's, which stays on screen while this shows (HON-1257).
export default function HouseholdMealPreferencesLoading() {
  return (
    <div className="flex flex-col gap-10">
      {/* Food preferences (four fields), then Meals to plan (the grid's two
          rows). No Save block: a section's button shows only once a field in
          it changes (HON-961). */}
      {[4, 2].map((fields, section) => (
        <div key={section} className="flex flex-col gap-4">
          <Skeleton className="h-6 w-40" />
          {Array.from({ length: fields }, (_, i) => (
            <FieldSkeleton key={i} />
          ))}
        </div>
      ))}
    </div>
  )
}
