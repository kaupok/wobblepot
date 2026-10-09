'use client'

import { useEffect, useState, type RefObject } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Dialog, DialogDescription, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { Heading, Body } from '@/components/ui/typography'

const PROGRESS_KEYS = ['progress1', 'progress2', 'progress3', 'progress4'] as const

const MESSAGE_INTERVAL_MS = 3000
const SLOW_THRESHOLD_MS = 10000

interface GeneratingOverlayProps {
  /**
   * The control that started the wait, focused again when the overlay closes.
   * Each callsite disables that control in the same render that opens the
   * overlay, and Chromium blurs a disabled control, so the element Radix
   * records as focused on open can be the body (CLAUDE.md → Focus management).
   */
  returnFocusRef?: RefObject<HTMLElement | null>
}

/**
 * A modal dialog for the wait on `/api/meal-plans/generate`. The dialog traps
 * focus and hides the page from assistive technology. The user cannot close
 * it: the route writes the plan even when the client gives up, so there is no
 * honest Cancel (HON-1130).
 */
export function GeneratingOverlay({ returnFocusRef }: GeneratingOverlayProps) {
  const t = useTranslations('meal-plan.generating')
  const [messageIndex, setMessageIndex] = useState(0)
  const [isSlow, setIsSlow] = useState(false)

  useEffect(() => {
    const messageInterval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % PROGRESS_KEYS.length)
    }, MESSAGE_INTERVAL_MS)

    const slowTimeout = setTimeout(() => {
      setIsSlow(true)
      clearInterval(messageInterval)
    }, SLOW_THRESHOLD_MS)

    return () => {
      clearInterval(messageInterval)
      clearTimeout(slowTimeout)
    }
  }, [])

  const progressKey = PROGRESS_KEYS[messageIndex] ?? PROGRESS_KEYS[0]
  const displayMessage = isSlow ? t('slow') : t(progressKey)

  const preventDismiss = (event: Event) => event.preventDefault()

  return (
    <Dialog open>
      <DialogPortal>
        {/*
          The content is the scrim itself, without `DialogContent`: that adds
          its own lighter `DialogOverlay` and the card look, and this overlay
          is an 80% wash with no card (HON-823).
        */}
        <DialogPrimitive.Content
          className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center outline-none"
          onEscapeKeyDown={preventDismiss}
          onPointerDownOutside={preventDismiss}
          onInteractOutside={preventDismiss}
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef?.current
            if (!target) return
            event.preventDefault()
            target.focus()
          }}
        >
          <div className="flex flex-col items-center gap-6 text-center">
            <Loader2 className="text-primary h-12 w-12 animate-spin" />
            <div className="flex flex-col items-center gap-2">
              {/*
                `variant="h4"` is HON-607's. The `<h2>` tag answers to two
                callsites, neither visible from this file. The overlay renders
                in a portal at the end of `<body>`, after the page's last
                heading, and while it is open the page is `aria-hidden`.

                - `FillDaysAction.tsx` sits among the `h2` day labels. An
                  overlay deeper than `h3` would read as a skipped level if it
                  ever rendered inline again. Pinned in
                  `TimelineDayCard.test.tsx`.
                - `FirstTimeSetup.tsx` has its own `<h2>` title. A transient
                  status message must not outrank the screen it covers. The
                  `Generating` story's play function in
                  `FirstTimeSetup.stories.tsx` pins that.
              */}
              <DialogTitle asChild>
                <Heading variant="h4" as="h2">
                  {t('heading')}
                </Heading>
              </DialogTitle>
              {/* The dialog's description on open; the live region announces
                  each later change once. */}
              <DialogDescription asChild>
                <Body variant="muted" role="status" aria-live="polite">
                  {displayMessage}
                </Body>
              </DialogDescription>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
