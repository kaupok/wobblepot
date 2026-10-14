import { Skeleton } from '@/components/ui/skeleton'

// Mirrors `page.tsx` only: the "My account" title and the tabs are the
// layout's, which stays on screen while this shows (HON-1229). Bar heights
// match each rendered line box.
export default function AccountProfileLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Name field with Save, then the email */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-touch w-full md:h-10" />
        </div>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-7 w-48" />
        </div>
      </div>

      {/* Separator */}
      <Skeleton className="h-px w-full" />

      {/* Change password: heading, description, three fields */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-5 w-full max-w-sm" />
        <Skeleton className="h-touch w-full md:h-10" />
        <Skeleton className="h-touch w-full md:h-10" />
        <Skeleton className="h-touch w-full md:h-10" />
      </div>
    </div>
  )
}
