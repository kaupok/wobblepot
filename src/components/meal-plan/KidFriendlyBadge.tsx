import { Baby } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'

interface KidFriendlyBadgeProps {
  /**
   * The icon alone, for a badge row that already carries the slot and protein
   * badges (the recipe library card). The label stays in the accessible name
   * and in the tooltip.
   */
  compact?: boolean
}

/**
 * The one rendering of a meal's kid-friendly flag (HON-764). `secondary` is
 * re-scoped to the meal's chip colour inside `[data-meal-surface]`, so the same
 * markup reads on a neutral background and on a tinted meal card.
 */
export function KidFriendlyBadge({ compact = false }: KidFriendlyBadgeProps) {
  const t = useTranslations('meal-plan.detail')
  const label = t('kidFriendly')
  return (
    <Badge variant="secondary" title={compact ? label : undefined}>
      <Baby aria-hidden="true" />
      {compact ? <span className="sr-only">{label}</span> : label}
    </Badge>
  )
}
