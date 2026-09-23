import { Skeleton } from '@/components/ui/skeleton'

// Mirrors `page.tsx`: same container and `max-w-2xl` column, top-aligned, no
// bordered wrapper (HON-767). Bar heights match each rendered line box.
export default function ProfileLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex max-w-2xl flex-col gap-6">
        {/* Title (h-7, as /household) and description */}
        <div className="flex flex-col gap-1">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-6 w-56" />
        </div>

        {/* Name and email */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-7 w-36" />
          </div>
          <div className="flex flex-col gap-1">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-7 w-48" />
          </div>
        </div>

        {/* Separator */}
        <Skeleton className="h-px w-full" />

        {/* Your data */}
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-6 w-full max-w-sm" />
          <Skeleton className="h-touch w-36 md:h-10" />
        </div>

        {/* Separator */}
        <Skeleton className="h-px w-full" />

        {/* Danger zone */}
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-6 w-full max-w-sm" />
          <Skeleton className="h-touch w-32 md:h-10" />
        </div>
      </div>
    </div>
  )
}
