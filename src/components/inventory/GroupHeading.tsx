import type { ReactNode } from 'react'
import { Body, Heading } from '@/components/ui/typography'

interface GroupHeadingProps {
  /** The group's name — "Staples", "Protein (4)", "Today (3)". */
  label: ReactNode
  /** A fact about the group on the same line, right-aligned — "4 items", "1/3". */
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
export function GroupHeading({ label, count }: GroupHeadingProps) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Heading variant="caption" as="h3">
        {label}
      </Heading>
      {count !== undefined && count !== null && count !== false && (
        <Body variant="caption">{count}</Body>
      )}
    </div>
  )
}
