import { Baby } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTapTooltip } from '@/hooks/use-tap-tooltip'

interface KidFriendlyBadgeProps {
  /**
   * The icon alone, for a badge row that already carries the slot and protein
   * badges (the recipe library card). The label stays in the accessible name
   * and in the tooltip.
   */
  compact?: boolean
  /**
   * `lg` in the cook view, where text stays at 16px or above (HON-932): the
   * badge and, when `compact`, its tooltip (HON-1023)
   */
  size?: 'default' | 'lg'
}

/**
 * The one rendering of a meal's kid-friendly flag (HON-764). `secondary` is
 * re-scoped to the meal's chip colour inside `[data-meal-surface]`, so the same
 * markup reads on a neutral background and on a tinted meal card.
 */
export function KidFriendlyBadge({ compact = false, size = 'default' }: KidFriendlyBadgeProps) {
  const t = useTranslations('meal-plan.detail')
  const label = t('kidFriendly')
  // In the cook view (`lg`) a tap opens it too, because a phone has no hover
  // (HON-1023). The cards keep the mouse hint.
  const tap = useTapTooltip(size === 'lg')
  if (!compact) {
    return (
      <Badge variant="secondary" size={size}>
        <Baby aria-hidden="true" />
        {label}
      </Badge>
    )
  }
  // The app's `Tooltip`, not the native `title`: the browser's bubble is the
  // one surface in the app the theme cannot style. The badge is not focusable,
  // so the tooltip is a mouse hint (and a tap target at `lg`); the `sr-only`
  // label is the name. The
  // explicit `data-slot` keeps the badge a badge: the trigger's own slot wins
  // through `asChild` otherwise, and the badge-row stories query the slot.
  return (
    <Tooltip {...tap.rootProps}>
      <TooltipTrigger asChild {...tap.triggerProps}>
        <Badge variant="secondary" size={size} data-slot="badge">
          <Baby aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent size={size}>{label}</TooltipContent>
    </Tooltip>
  )
}
