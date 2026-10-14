import { Skeleton } from '@/components/ui/skeleton'

// Mirrors `page.tsx` only: the "My account" title and the tabs are the
// layout's, which stays on screen while this shows (HON-1229). Bar heights
// match each rendered line box.
export default function AccountDataLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Your data */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-5 w-full max-w-sm" />
        <Skeleton className="h-touch w-36 md:h-10" />
      </div>

      {/* Separator */}
      <Skeleton className="h-px w-full" />

      {/* Danger zone */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-5 w-full max-w-sm" />
        <Skeleton className="h-touch w-32 md:h-10" />
      </div>
    </div>
  )
}
