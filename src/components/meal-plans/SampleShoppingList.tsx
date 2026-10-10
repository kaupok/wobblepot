'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Body, Li, Ul } from '@/components/ui/typography'
import { GroupHeading } from '@/components/inventory/GroupHeading'
import { CATEGORY_EMOJI } from '@/components/shopping/CategoryGroup'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import type { SampleShoppingGroup } from '@/lib/meal-plans/build-sample-week'

function ShoppingGroup({ group }: { group: SampleShoppingGroup }) {
  const label = useEnumLabel('IngredientCategory', group.category)
  const headingId = `sample-shopping-${group.category}`
  return (
    <div className="flex flex-col gap-2">
      <div id={headingId}>
        <GroupHeading
          emoji={CATEGORY_EMOJI[group.category]}
          label={label}
          total={group.items.length}
        />
      </div>
      <Ul variant="plain" aria-labelledby={headingId}>
        {group.items.map((item) => (
          <Li key={item.id} className="flex items-baseline justify-between gap-3">
            <Body variant="small">{item.name}</Body>
            <span className="shrink-0 tabular-nums">
              <Body variant="small">{item.quantity}</Body>
            </span>
          </Li>
        ))}
      </Ul>
    </div>
  )
}

/**
 * A sample week's shopping list (`/meal-plans/<slug>`, HON-1085): every
 * ingredient of the seven dinners summed for the page's household, grouped
 * by category in the real list's order, on the shopping list's note sheet
 * (docs/DESIGN.md → "The shopping list is one note sheet"). Read-only, and
 * with no pantry deduction: the visitor has no pantry here.
 */
export function SampleShoppingList({ groups }: { groups: SampleShoppingGroup[] }) {
  return (
    <Card data-surface="note">
      <CardContent>
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <ShoppingGroup key={group.category} group={group} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
