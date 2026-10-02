import { cn } from '@/lib/utils'

/**
 * One bordered box around a group of list rows, with a divider between rows.
 *
 * The rows on `/shopping` and `/pantry` used to carry their own `rounded-lg
 * border`, one card per item. A group now reads as one card: the box is drawn
 * here, the rows keep only their `p-3` and backgrounds, and `divide-y` draws
 * the separator. `overflow-hidden` clips a row's hover and purchased background
 * to the corners.
 *
 * The geometry lives here once so the skeletons in `src/app/shopping/loading.tsx`
 * cannot drift from the live list (CLAUDE.md → Shared-primitive geometry).
 */
function RowGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="row-group"
      className={cn('divide-y overflow-hidden rounded-lg border', className)}
      {...props}
    />
  )
}

export { RowGroup }
