'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Callout } from '@/components/ui/callout'

interface TimelinePastNoticeProps {
  /** Past entries still in `planned` status (`countPastCatchUp`). */
  count: number
}

/**
 * The nudge above Today that past meals still need marking. Marking one cooked
 * runs the pantry deduction and the rating prompt, so it must be visible
 * without opening a menu (HON-1007). Info, not warning: unmarked meals are
 * routine, and nothing is wrong (HON-1018). No dismiss: the count covers seven
 * days, so unmarked meals drop off on their own.
 */
export function TimelinePastNotice({ count }: TimelinePastNoticeProps) {
  const t = useTranslations('meal-plan.past')

  if (count <= 0) return null

  return (
    <Callout tone="info">
      {t('notice', { count })}{' '}
      {/* Foreground text, not `text-primary`: primary on the info tint is
          not guaranteed AA. The underline is the link's cue. */}
      <Link href="/past-meals" className="font-medium underline underline-offset-2">
        {t('noticeLink')}
      </Link>
    </Callout>
  )
}
