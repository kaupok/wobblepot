import React from 'react'
import { Body } from '@/components/ui/typography'

export const NUTRITION_DISCLAIMER_TEXT =
  'Nutrition values are estimates for guidance only and are not medical advice. Consult a healthcare professional for dietary decisions.'

// Rendered today on: `MealDetail` (meal detail surface, including `MealDetailModal`)
// and `MealForm` (meal creation/edit). Not rendered on `MealCardBase` — cards appear
// in lists and multiple disclaimers would be noisy.
// Future surfaces that must render this when they ship: Today-dashboard nutrition
// rollup, member-preferences macro-targets UI.
export const NutritionDisclaimer = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <Body ref={ref} variant="muted" className={className} {...props}>
    {NUTRITION_DISCLAIMER_TEXT}
  </Body>
))
NutritionDisclaimer.displayName = 'NutritionDisclaimer'
