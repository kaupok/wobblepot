import { Baby } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'

/**
 * The one rendering of a meal's kid-friendly flag (HON-764). `secondary` is
 * re-scoped to the meal's chip colour inside `[data-meal-surface]`, so the same
 * markup reads on a neutral background and on a tinted meal card.
 */
export function KidFriendlyBadge() {
  const t = useTranslations('meal-plan.detail')
  return (
    <Badge variant="secondary">
      <Baby aria-hidden="true" />
      {t('kidFriendly')}
    </Badge>
  )
}
