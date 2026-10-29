'use client'

import { useTranslations } from 'next-intl'
import { useId } from 'react'

import { Body, Heading, Li, Ul } from '@/components/ui/typography'

import type { EntryChange } from './types'

interface EntryChangesListProps {
  changes: readonly EntryChange[]
}

/**
 * The entry's ingredient changes above the preparation steps (HON-1243), so
 * the cook sees them while cooking: "Replaced: Cream → Yoghurt". Names follow
 * a separator, so Estonian needs no declension. A stale change does nothing,
 * so it is not listed here; the ingredient list shows it with its Undo.
 */
export function EntryChangesList({ changes }: EntryChangesListProps) {
  const t = useTranslations('meal-plan.changes')
  const headingId = useId()
  const live = changes.filter((change) => !change.stale)
  if (live.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <Heading variant="h4" as="h3" id={headingId}>
        {t('summaryTitle')}
      </Heading>
      <Ul variant="plain" aria-labelledby={headingId}>
        {live.map((change) => (
          <Li key={change.id}>
            <Body variant="step">
              {change.original && change.replacement
                ? t('summaryReplaced', {
                    original: change.original.name,
                    replacement: change.replacement.name,
                  })
                : change.replacement
                  ? t('summaryAdded', { name: change.replacement.name })
                  : t('summaryLeftOut', { name: change.original?.name ?? '' })}
            </Body>
          </Li>
        ))}
      </Ul>
    </section>
  )
}
