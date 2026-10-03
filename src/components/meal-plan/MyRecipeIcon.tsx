import { BookOpen } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface MyRecipeIconProps {
  /**
   * `lg` after the cook view's `display` title (HON-1023): the `icon-display`
   * button, a 20px icon (24px from `lg`) in a 24px box with a 44px target, and
   * the cook view's `lg` tooltip.
   */
  size?: 'default' | 'lg'
}

/**
 * Marks one of the household's own recipes (`isCustom`): the bare icon after
 * the meal's name, not a pill in the badge row, because it is a status of the
 * recipe and not a category like the slot or the protein (HON-973). The cards
 * and the cook view use the same mark (HON-1023). The icon is the one the
 * header and tab bar use for My recipes, so the mark and the destination match.
 * Place it after the name with a no-break space, so it wraps with the last word.
 *
 * The trigger is a focusable button, so the tooltip opens on keyboard focus as
 * well as on hover, and its label is the accessible name without the tooltip.
 * On the cards it is `icon-xs` with a 14px icon. Never nest it in another
 * button or link, and keep it out of the element a dialog's `aria-labelledby`
 * points to, so the dialog's name stays the meal name.
 */
export function MyRecipeIcon({ size = 'default' }: MyRecipeIconProps) {
  const t = useTranslations('meal-plan.card')
  const label = t('myRecipe')
  const lg = size === 'lg'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="quiet"
          size={lg ? 'icon-display' : 'icon-xs'}
          shape="pill"
          aria-label={label}
          className="align-middle"
        >
          {lg ? (
            <BookOpen aria-hidden="true" />
          ) : (
            <BookOpen className="size-3.5" aria-hidden="true" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent size={size}>{label}</TooltipContent>
    </Tooltip>
  )
}
