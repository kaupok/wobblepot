import { BookOpen } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'

interface MyRecipeBadgeProps {
  /**
   * The icon alone, for a card's badge row (the planner card and the meal
   * selector). The label stays in the accessible name and in the tooltip.
   */
  compact?: boolean
  /** `lg` in the cook view, where text stays at 16px or above (HON-932) */
  size?: 'default' | 'lg'
}

/**
 * Marks one of the household's own recipes (`isCustom`) among library meals
 * (HON-948). The icon is the one the header and tab bar use for My recipes, so
 * the mark and the destination match. `secondary` follows the meal's chip
 * colour inside `[data-meal-surface]`, as `KidFriendlyBadge` does.
 */
export function MyRecipeBadge({ compact = false, size = 'default' }: MyRecipeBadgeProps) {
  const t = useTranslations('meal-plan.card')
  const label = t('myRecipe')
  return (
    <Badge variant="secondary" size={size} title={compact ? label : undefined}>
      <BookOpen aria-hidden="true" />
      {compact ? <span className="sr-only">{label}</span> : label}
    </Badge>
  )
}
