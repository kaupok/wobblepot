'use client'

import { TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Body, Li, Ul } from '@/components/ui/typography'

import type { ExcludedMatch } from './preference-values'

interface ExcludedMatchesProps {
  /** The saved tags still in the input, in its order. */
  tags: readonly string[]
  /** What the preferences route matched for each saved tag. */
  matches: readonly ExcludedMatch[]
}

/**
 * Under "Ingredients to avoid", what each saved tag excludes (HON-1321): the
 * count, with the names in a disclosure, or a warning for a tag that matches
 * no ingredient. A tag typed since the last save has no line until it is
 * saved, because only the server can match it.
 */
export function ExcludedMatches({ tags, matches }: ExcludedMatchesProps) {
  const t = useTranslations('household.settings')
  const byTag = new Map(matches.map((match) => [match.tag, match.ingredients]))
  const shown = tags.flatMap((tag) => {
    const ingredients = byTag.get(tag)
    return ingredients ? [{ tag, ingredients }] : []
  })
  if (shown.length === 0) return null

  return (
    <Ul variant="plain" aria-label={t('excludedMatchesLabel')}>
      {shown.map(({ tag, ingredients }) => (
        <Li key={tag}>
          {ingredients.length > 0 ? (
            <details>
              {/* A summary takes phrasing content only, so no `Body` (a p). */}
              <summary className="text-muted-foreground cursor-pointer text-sm">
                {t('excludedMatchCount', { tag, count: ingredients.length })}
              </summary>
              <div className="mt-1 ml-4">
                <Body variant="muted">{ingredients.map((i) => i.name).join(', ')}</Body>
              </div>
            </details>
          ) : (
            <div className="flex items-start gap-1.5">
              <TriangleAlert aria-hidden className="text-warning mt-0.5 size-4 shrink-0" />
              <Body variant="paragraph" tone="warning">
                {t('excludedNoMatch', { tag })}
              </Body>
            </div>
          )}
        </Li>
      ))}
    </Ul>
  )
}
