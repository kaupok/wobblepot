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
 * pointer, and a mouse also opens it on hover and closes it on leave. A click
 * on a hover-opened tip pins it: it stays open after the mouse leaves, until a
 * second click, a click outside or Escape.
 *
 * Focus never moves: opening by hover must not pull focus off whatever the user
 * was on, and Escape leaves it on the button rather than sending it elsewhere.
 * So a screen reader would never reach the portaled content; the button carries
 * the same text as its description instead, read out when it takes focus.
 */
export function InfoTip({ label, children, size = 'default' }: InfoTipProps) {
  const [open, setOpen] = React.useState(false)
  // Set while the tip is open only because a mouse is over the button. A click
  // always follows a mouse pointerenter, so without this the click would toggle
  // the hover-opened tip straight back shut.
  const openedByHover = React.useRef(false)
  const descriptionId = React.useId()

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) openedByHover.current = false
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="quiet"
          size="icon-xs"
          shape="pill"
          aria-label={label}
          aria-describedby={descriptionId}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse' && !open) {
              openedByHover.current = true
              setOpen(true)
            }
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse' && openedByHover.current) {
              openedByHover.current = false
              setOpen(false)
            }
          }}
          onClick={(event) => {
            // Slot runs this before PopoverTrigger's toggle, which skips a
            // prevented event: a click on a hover-opened tip pins it open.
            if (openedByHover.current) {
              openedByHover.current = false
              event.preventDefault()
            }
          }}
        >
          <Info className={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden />
        </Button>
      </PopoverTrigger>
      {/* Absolutely positioned, so it takes no gap in the caller's flex row. */}
      <span id={descriptionId} className="sr-only">
        {children}
      </span>
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
