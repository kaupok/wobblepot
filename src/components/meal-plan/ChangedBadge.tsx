import { PencilLine } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'

/**
 * On a planner card whose entry has its own ingredient changes (HON-1243),
 * beside the conflict badges: this meal is not cooked as the recipe says.
 */
export function ChangedBadge() {
  const t = useTranslations('meal-plan.changes')
  return (
    <Badge variant="info">
      <PencilLine aria-hidden="true" />
      {t('badge')}
    </Badge>
  )
}
