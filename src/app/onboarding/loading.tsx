import { Skeleton } from '@/components/ui/skeleton'

// Mirrors step 1 of `OnboardingFlow` in `page.tsx`'s top-anchored wrapper, so
// the card does not jump when it loads.
export default function OnboardingLoading() {
  return (
    <div className="min-h-screen-below-header flex items-start justify-center px-4 pt-4 pb-16 md:pt-12">
      <div className="w-full max-w-md rounded-lg border p-6">
        {/* Step count, progress bar, title, description */}
        <div className="mb-6 flex flex-col gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-1 w-full" />
          <Skeleton className="mt-2 h-7 w-64" />
          <Skeleton className="h-5 w-72" />
        </div>

        {/* Household name field */}
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-touch w-full md:h-10" />
        </div>

        {/* Continue */}
        <div className="mt-6">
          <Skeleton className="h-12 w-full md:h-11" />
        </div>
      </div>
    </div>
  )
}
