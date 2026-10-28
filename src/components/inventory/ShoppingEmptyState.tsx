'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'

/**
 * Why the shopping list has nothing to show. `error` replaces the list; the
 * other two keep the note sheet and its Add field, and only pick the muted line
 * under it (HON-1354).
 */
export type ShoppingEmptyStateVariant = 'no-plan' | 'nothing-needed' | 'error'

/**
 * The load-failed state: the one state with no list, no header and no sheet,
 * since the window picker and the Add field both need a list that loaded.
 *
 * Sits on the page background like the populated list does, and starts at the
 * top of its column rather than centring in a card, so the column keeps the
 * same top edge whichever state it lands on (docs/DESIGN.md → Composition
 * rules, "Content starts at the top"). With no header its heading is the
 * column's title.
 */
export function ShoppingEmptyState() {
  const t = useTranslations('shopping.emptyState')

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Heading variant="h4" as="h2">
            {t('errorHeading')}
          </Heading>
          <Body variant="muted">{t('errorBody')}</Body>
        </div>
        <Button asChild className="w-full md:w-auto md:self-start">
          <Link href="/">{t('errorCta')}</Link>
        </Button>
      </div>
    </section>
  )
}
