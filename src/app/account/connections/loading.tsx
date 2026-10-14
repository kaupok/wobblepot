import { Skeleton } from '@/components/ui/skeleton'

// Mirrors `page.tsx` only: the "My account" title and the tabs are the
// layout's, which stays on screen while this shows (HON-1229).
export default function AccountConnectionsLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Connect to an AI assistant: heading, description, server URL */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-5 w-full max-w-sm" />
        <Skeleton className="h-touch w-full md:h-10" />
      </div>

      {/* Separator */}
      <Skeleton className="h-px w-full" />

      {/* Screens and scripts: heading, description, key name field */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-5 w-full max-w-sm" />
        <Skeleton className="h-touch w-full md:h-10" />
      </div>
    </div>
  )
}
