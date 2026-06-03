import React from 'react'
import { useTranslations } from 'next-intl'
import { Body } from '@/components/ui/typography'

// Rendered today on: `MealDetail` (meal detail surface, including `MealDetailModal`)
// and `MealForm` (meal creation/edit). Not rendered on `MealCardBase` — cards appear
// in lists and multiple disclaimers would be noisy.
// Future surfaces that must render this when they ship: Today-dashboard nutrition
// rollup, member-preferences macro-targets UI.
// Copy is localized via the `common.nutritionDisclaimer` message catalog key.
export const NutritionDisclaimer = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => {
  const t = useTranslations('common')
  return (
    <Body ref={ref} variant="muted" className={className} {...props}>
      {t('nutritionDisclaimer')}
    </Body>
  )
})
NutritionDisclaimer.displayName = 'NutritionDisclaimer'
