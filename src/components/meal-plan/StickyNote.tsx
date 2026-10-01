import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// A meal note as a taped yellow slip (docs/DESIGN.md → "Notes are sticky
// notes"). The colour, the re-scoped tokens and the tape come from
// `[data-surface='sticky']` in globals.css; this owns the shape and the tilt.
// No border and no shadow: it is paper stuck onto the card, not a card in it.
const stickyNoteVariants = cva('flex flex-col self-start rounded-sm px-4 pt-3.5 pb-3 text-left', {
  variants: {
    variant: {
      // Read-only: past or read-only slots.
      static: 'w-fit max-w-xs -rotate-1',
      // A saved note that opens the editor. It straightens on hover and on
      // keyboard focus. The outline is the slip's `--ring` (re-scoped to its
      // muted text) at full strength: at half, it fades into the yellow.
      interactive:
        'focus-visible:outline-ring min-h-8 w-fit max-w-xs -rotate-1 cursor-pointer transition-transform duration-200 ease-out hover:rotate-0 focus-visible:rotate-0 focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none',
      // The editor: straight, at the full width so typing has room. The
      // textarea inside draws no outline of its own, so the slip shows focus.
      editing:
        'focus-within:outline-ring w-full max-w-xs gap-2 focus-within:outline-2 focus-within:outline-offset-2',
    },
  },
  defaultVariants: { variant: 'static' },
})

interface StickyNoteProps
  extends React.ComponentProps<'div'>, VariantProps<typeof stickyNoteVariants> {
  /** Render the slip onto its only child — the note's `button` in display mode. */
  asChild?: boolean
}

function StickyNote({ className, variant, asChild = false, ...props }: StickyNoteProps) {
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp
      data-surface="sticky"
      data-slot="sticky-note"
      data-variant={variant ?? 'static'}
      className={cn(stickyNoteVariants({ variant }), className)}
      {...props}
    />
  )
}

export { StickyNote }
