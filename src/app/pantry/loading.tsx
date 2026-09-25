// The same two columns as `src/app/shopping/loading.tsx`; only which one a
// phone sees differs. The column skeletons live there so the geometry is
// written once (CLAUDE.md → Shared-primitive geometry).
import { PantryColumnSkeleton, ShoppingColumnSkeleton } from '../shopping/loading'

export default function PantryLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid gap-8 md:grid-cols-2">
        {/* Pantry section — all a phone sees on `/pantry` (HON-776). */}
        <div>
          <PantryColumnSkeleton />
        </div>

        {/* Shopping section — the right column from `md`, as on `/shopping`. */}
        <div className="hidden md:block">
          <ShoppingColumnSkeleton />
        </div>
      </div>
    </div>
  )
}
