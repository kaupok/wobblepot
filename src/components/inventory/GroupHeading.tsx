import type { ReactNode } from 'react'
import { useLocale } from 'next-intl'
import { Body, Heading } from '@/components/ui/typography'
import { formatInteger } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'

interface GroupHeadingProps {
  /** The group's name — "Staples", "Protein", "Today". */
  label: ReactNode
  /**
   * A shopping-list group's emoji, shown before the label. Decorative: it is
   * hidden from the accessibility tree, so the heading's name stays "Protein
   * 4". The one place the app uses emoji as an icon (docs/DESIGN.md → Icons).
   */
  emoji?: string
  /**
   * How many rows the group holds, as a plain number after the label in the
   * caption's own muted colour. Part of the heading, so its name reads
   * "Protein 4".
   */
  total?: number
  /** Progress through the group on the same line, right-aligned — "1/3". */
  count?: ReactNode
}

/**
 * The heading over a group of rows on `/shopping` and `/pantry`: the pantry's
 * staples and on-hand groups, the list's category, urgency, "Other" and
 * "Custom items" groups. Caption level, one step under the column's Title,
 * so it divides the list without competing with the rows (docs/DESIGN.md →
 * Composition rules, "Headings divide, borders contain"). `h3` because every
 * column title is an `h2`.
 */
export function GroupHeading({ label, emoji, total, count }: GroupHeadingProps) {
  const locale = useLocale() as Locale

  return (
    <div className="flex items-baseline justify-between gap-3">
      <Heading variant="caption" as="h3">
        {emoji && (
          <span aria-hidden="true" className="mr-2">
            {emoji}
          </span>
        )}
        {label}
        {total !== undefined && (
          <>
            {/* The space keeps the name "Protein 4", not "Protein4"; the
                margin tops it up to the gap after the emoji. */}{' '}
            {/* No colour or size of its own: it takes the caption's, so on
                the shopping note it takes the note's muted token. One weight
                under the label, so it reads as a count, not part of the name. */}
            <span className="ml-1 font-normal tabular-nums">{formatInteger(total, locale)}</span>
          </>
        )}
      </Heading>
      {count !== undefined && count !== null && count !== false && (
        <Body variant="caption">{count}</Body>
      )}
    </div>
  )
}
