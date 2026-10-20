import { Skeleton } from '@/components/ui/skeleton'

// Mirrors `page.tsx` only: the "My account" title and the tabs are the
// layout's, which stays on screen while this shows (HON-1229). Bar heights
// match each rendered line box.
export default function AccountProfileLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Name field with Save, then the email field with Change email (HON-1137) */}
      <div className="flex flex-col gap-4">
        {[0, 1].map((field) => (
          <div key={field} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-touch w-full md:h-10" />
          </div>
        ))}
      </div>

      {/* Separator */}
      <Skeleton className="h-px w-full" />

      {/* Sign-in methods: heading, description, the password and Google rows */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-5 w-full max-w-xs" />
        <div className="flex flex-col divide-y">
          {[0, 1].map((row) => (
            <div key={row} className="flex flex-col gap-1 py-3">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-5 w-32" />
            </div>
          ))}
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
