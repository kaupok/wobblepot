import { BookOpen } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface MyRecipeBadgeProps {
  /** `lg` in the cook view, where text stays at 16px or above (HON-932) */
  size?: 'default' | 'lg'
}

/**
 * Marks one of the household's own recipes (`isCustom`) in the cook view
 * (HON-948, HON-953). The icon is the one the header and tab bar use for My
 * recipes, so the mark and the destination match. `secondary` follows the
 * meal's chip colour inside `[data-meal-surface]`, as `KidFriendlyBadge` does.
 * The cards use `MyRecipeIcon` instead.
 */
export function MyRecipeBadge({ size = 'default' }: MyRecipeBadgeProps) {
  const t = useTranslations('meal-plan.card')
  return (
    <Badge variant="secondary" size={size}>
      <BookOpen aria-hidden="true" />
      {t('myRecipe')}
    </Badge>
  )
}

/**
 * The same mark on the planner and selector cards: the bare icon after the
 * meal's name, not a pill in the badge row, because it is a status of the
 * recipe and not a category like the slot or the protein (HON-973). Place it
 * after the name with a no-break space, so it wraps with the last word.
 *
 * The trigger is a focusable `icon-xs` button, so the tooltip opens on keyboard
 * focus as well as on hover, and its label is the accessible name without the
 * tooltip. The 14px icon is the badge's, so the mark did not grow when it left
 * the badge. Never nest it in another button or link.
 */
export function MyRecipeIcon() {
  const t = useTranslations('meal-plan.card')
  const label = t('myRecipe')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="quiet"
          size="icon-xs"
          shape="pill"
          aria-label={label}
          className="align-middle"
        >
          <BookOpen className="size-3.5" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
