'use client'

import { useRef } from 'react'
import { ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface TimelinePastMenuProps {
  expanded: boolean
  /** Past entries still in `planned` status — drives the warning dot and count. */
  catchUpCount: number
  onToggle: () => void
}

/**
 * Overflow menu on the Today heading that shows or hides past days. The
 * catch-up count is the only nudge that past meals still need marking, so it
 * surfaces as a warning dot on the trigger and as text on the menu item.
 */
export function TimelinePastMenu({ expanded, catchUpCount, onToggle }: TimelinePastMenuProps) {
  const tPast = useTranslations('meal-plan.past')
  const hasCatchUp = catchUpCount > 0
  const triggerRef = useRef<HTMLButtonElement>(null)
  const interactedOutsideRef = useRef(false)

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={
            hasCatchUp ? tPast('menuLabelWithCatchUp', { count: catchUpCount }) : tPast('menuLabel')
          }
        >
          <MoreHorizontal aria-hidden="true" />
          {hasCatchUp && (
            <span
              aria-hidden="true"
              className="bg-warning absolute top-1 right-1 size-2 rounded-full"
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // Radix restores focus with a plain `focus()`, which scrolls the
        // trigger back into view and cancels the scroll to the first past day
        // that `TimelineView` starts on expand. Restore it without scrolling,
        // keeping Radix's rule of leaving focus alone after an outside click.
        onInteractOutside={() => {
          interactedOutsideRef.current = true
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          // `preventScroll` only while expanding: that is when the trigger's
          // own scroll-into-view would cancel the scroll to the first past
          // day. On collapse the removed days leave the trigger off-screen,
          // so the browser should be allowed to bring it back.
          if (!interactedOutsideRef.current) triggerRef.current?.focus({ preventScroll: expanded })
          interactedOutsideRef.current = false
        }}
      >
        <DropdownMenuItem onSelect={onToggle}>
          {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          {expanded ? tPast('hide') : tPast('show')}
          {hasCatchUp && ` · ${tPast('catchUp', { count: catchUpCount })}`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
