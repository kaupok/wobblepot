'use client'

import * as React from 'react'
import { Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Body } from '@/components/ui/typography'

interface InfoTipProps {
  /** Accessible name of the (i) button, from the catalog. */
  label: string
  /** The explanation shown in the popover. */
  children: React.ReactNode
  /** `sm` sits in a line of `text-xs`; `default` beside `text-sm` and up. */
  size?: 'sm' | 'default'
}

/**
 * An (i) button that explains the text beside it (HON-930). Not a `Tooltip`:
 * Radix Tooltip opens on hover and focus but not on tap, so a phone could never
 * reach the explanation. A popover opens on click (tap, Enter, Space) for every
 * pointer, and a mouse also opens it on hover and closes it on leave.
 *
 * Focus never moves: opening by hover must not pull focus off whatever the user
 * was on, and Escape leaves it on the button rather than sending it elsewhere.
 */
export function InfoTip({ label, children, size = 'default' }: InfoTipProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="quiet"
          size="icon-xs"
          shape="pill"
          aria-label={label}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') setOpen(true)
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') setOpen(false)
          }}
        >
          <Info className={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        // Radix gives the content `role="dialog"`, which needs a name.
        aria-label={label}
        className="w-auto max-w-xs px-3 py-2"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {/* `paragraph`, not `small`: the sentence wraps, and `small` is `leading-none`. */}
        <Body variant="paragraph">{children}</Body>
      </PopoverContent>
    </Popover>
  )
}
