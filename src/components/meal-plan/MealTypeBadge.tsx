'use client'

import { Badge } from '@/components/ui/badge'
import type { MealType } from '@/generated/prisma/enums'
import { useEnumLabel } from '@/lib/i18n/enum-label'

/**
 * The slot a planner card fills — Breakfast, Lunch or Dinner — as the first
 * row inside the card, so the card carries its own context wherever it goes
 * (docs/DESIGN.md → Composition). `secondary` is re-scoped to the meal's chip
 * colour inside `[data-meal-surface]`, as on `KidFriendlyBadge`, so it reads
 * on the neutral card and on a tinted one.
 */
export function MealTypeBadge({ mealType }: { mealType: MealType }) {
  const label = useEnumLabel('MealType', mealType)
  // The span lets a `MealBadgeRow` cut the label short (HON-1575).
  return (
    <Badge variant="secondary">
      <span className="truncate">{label}</span>
    </Badge>
  )
}
