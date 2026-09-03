'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Heading, Body } from '@/components/ui/typography'

const PROGRESS_KEYS = ['progress1', 'progress2', 'progress3', 'progress4'] as const

const MESSAGE_INTERVAL_MS = 3000
const SLOW_THRESHOLD_MS = 10000

export function GeneratingOverlay() {
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

  return (
    <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
      <div className="flex flex-col items-center gap-6 text-center">
        <Loader2 className="text-primary h-12 w-12 animate-spin" />
        <div className="flex flex-col items-center gap-2">
          {/*
            `variant="h4"` is HON-607's, but this is the one site in that sweep
            that does *not* keep its old `<h2>` tag: the natural `h4` tag is
            load-bearing here, so there is deliberately no `as`. Two callsites
            constrain it, and neither is visible from this file:

            - `FillDaysAction.tsx:103` emits the overlay between the planned and
              empty `TimelineDayCard`s, so an `h5` day label follows it. At
              `<h2>` that is a skipped level to axe's `heading-order`
              (`5 - 2 > 1`). Pinned in `TimelineDayCard.test.tsx`.
            - `FirstTimeSetup.tsx:94` emits it just before that screen's own
              `<h2>` title. Any tag is a legal decrease there, so axe is blind;
              what matters is editorial — a transient status message must not
              outrank the screen it covers. Pinned by the `Generating` story's
              play function in `FirstTimeSetup.stories.tsx`.

            Do not "restore" `as="h2"` for symmetry with the other five sites
            HON-607 migrated. (HON-619)
          */}
          <Heading variant="h4">{t('heading')}</Heading>
          <Body variant="muted">{displayMessage}</Body>
        </div>
      </div>
    </div>
  )
}
