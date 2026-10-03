import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * A group of list rows with a divider between rows.
 *
 * The rows on `/shopping` and `/pantry` used to carry their own `rounded-lg
 * border`, one card per item. A group now reads as one card: the box is drawn
 * here, the rows keep only their `p-3` and backgrounds, and `divide-y` draws
 * the separator. `overflow-hidden` clips a row's hover and purchased background
 * to the corners.
 *
 * `ruled` is the same rows on a sheet that is already the container, the
 * shopping list's note (HON-1016): a box inside it would be a card inside a
 * card, so it keeps only the dividers. `-mx-3` pulls the rows out by their own
 * `p-3`, so their content lines up with the group heading and the Add field
 * above it while the hover wash keeps its air on both sides.
 *
 * The geometry lives here once so the skeletons in `src/app/shopping/loading.tsx`
 * cannot drift from the live list (CLAUDE.md → Shared-primitive geometry).
 */
const rowGroupVariants = cva('divide-y', {
  variants: {
    variant: {
      default: 'overflow-hidden rounded-lg border',
      ruled: '-mx-3',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

function RowGroup({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof rowGroupVariants>) {
  return (
    <div
      data-slot="row-group"
      data-variant={variant ?? 'default'}
      className={cn(rowGroupVariants({ variant }), className)}
      {...props}
    />
  )
}

export { RowGroup, rowGroupVariants }
