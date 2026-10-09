import { TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import type { PreferenceConflict } from '@/lib/meal-planning/preference-conflicts'

interface ConflictBadgeProps {
  conflict: PreferenceConflict
  /** `lg` in the cook view, where text stays at 16px or above (HON-932). */
  size?: 'default' | 'lg'
}

/**
 * A household food preference the planned meal breaks (HON-1126): "Contains:
 * Tree nuts", "Not suitable: Vegan", "Has an avoided ingredient". The name
 * follows a separator, so Estonian needs no declension of the enum label.
 * The text names the problem, so the colour is never the only cue.
 */
export function ConflictBadge({ conflict, size = 'default' }: ConflictBadgeProps) {
  const t = useTranslations('meal-plan.card.conflict')
  // Cast as `useEnumLabel` does: the constraint is a runtime enum value.
  const tAllergen = useTranslations('enums.Allergen') as unknown as (key: string) => string
  const tDiet = useTranslations('enums.DietaryType') as unknown as (key: string) => string

  const label =
    conflict.kind === 'allergen'
      ? t('allergen', { allergen: tAllergen(conflict.constraint) })
      : conflict.kind === 'diet'
        ? t('diet', { diet: tDiet(conflict.constraint) })
        : t('excluded')

  return (
    <Badge variant="destructive" size={size}>
      <TriangleAlert aria-hidden="true" />
      {label}
    </Badge>
  )
}

interface ConflictBadgesProps {
  conflicts: readonly PreferenceConflict[]
  size?: 'default' | 'lg'
}

/** One `ConflictBadge` per conflict, as siblings for the caller's badge row. */
export function ConflictBadges({ conflicts, size }: ConflictBadgesProps) {
  return conflicts.map((conflict) => (
    <ConflictBadge
      key={`${conflict.kind}:${conflict.constraint}`}
      conflict={conflict}
      size={size}
    />
  ))
}
