import { Skeleton } from '@/components/ui/skeleton'

// Mirrors `page.tsx` only: the "My account" title and the tabs are the
// layout's, which stays on screen while this shows (HON-1229). Bar heights
// match each rendered line box.
export default function AccountRemindersLoading() {
  return (
    <div className="flex flex-col gap-4">
      {/* Weekly reminder heading */}
      <Skeleton className="h-7 w-36" />
      {/* The checkbox and its label */}
      <div className="flex items-start gap-2">
        <Skeleton className="size-4 shrink-0" />
        <Skeleton className="h-5 w-48" />
      </div>
      {/* The helper line, two lines on a phone */}
      <div className="flex flex-col gap-1">
        <Skeleton className="h-5 w-full max-w-md" />
        <Skeleton className="h-5 w-2/3 md:hidden" />
      </div>
    </div>
  )
}
