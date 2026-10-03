import { cn } from '@/lib/utils'
import type { InventoryView } from './InventoryPage'

interface ShoppingPaperProps {
  /** Which half a phone sees: the paper covers the screen only on `/shopping`. */
  view: InventoryView
}

/**
 * The shopping note's paper behind the list half of Pantry & shopping
 * (docs/DESIGN.md → Composition rules, HON-1012). From `md` up it covers the
 * right half of the viewport, top to bottom, so the split sits at the centre
 * of the column gap: `main` is `max-w-page mx-auto` and the page shell's
 * padding is symmetric, so that centre is the viewport's. A flat edge, never a
 * gradient. Fixed, so it does not stop where the list does, and behind the
 * page (`-z-10`), so the header pills float over it and the footer's own
 * background covers it.
 *
 * Shared with the route skeletons so the colour is there before the data is.
 */
export function ShoppingPaper({ view }: ShoppingPaperProps) {
  return (
    <div
      aria-hidden
      data-surface="note"
      data-testid="shopping-paper"
      className={cn(
        'bg-card fixed inset-y-0 right-0 -z-10 md:left-1/2',
        view === 'shopping' ? 'left-0' : 'hidden md:block',
      )}
    />
  )
}
