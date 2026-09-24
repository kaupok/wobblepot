'use client'

import { Badge } from '@/components/ui/badge'
import { useEnumLabel } from '@/lib/i18n/enum-label'

/**
 * A meal's primary protein as an outline badge, beside the slot badge on a
 * planner card. Renders nothing for `none` or a missing value: "No protein"
 * is not a thing to wear. `outline` keeps it a step quieter than the filled
 * slot badge, and on a tinted card its text takes the meal's text colour.
 */
export function ProteinBadge({ proteinType }: { proteinType?: string | null }) {
  const label = useEnumLabel('ProteinType', proteinType ?? 'none')
  if (!proteinType || proteinType === 'none') return null
  return <Badge variant="outline">{label}</Badge>
}
