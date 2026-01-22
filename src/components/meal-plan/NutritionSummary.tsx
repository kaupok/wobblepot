import { Body } from '@/components/ui/typography'
import type { NutritionData } from './types'

interface NutritionSummaryProps {
  nutrition: NutritionData
  compact?: boolean
}

export function NutritionSummary({ nutrition, compact }: NutritionSummaryProps) {
  if (compact) {
    return (
      <div className="text-muted-foreground text-xs">
        {Math.round(nutrition.calories)} kcal · {Math.round(nutrition.protein)}g protein ·{' '}
        {Math.round(nutrition.carbs)}g carbs · {Math.round(nutrition.fat)}g fat
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Body variant="small" className="font-semibold">
        Nutrition (per serving)
      </Body>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">Calories</span>
        <span>{Math.round(nutrition.calories)} kcal</span>
        <span className="text-muted-foreground">Protein</span>
        <span>{Math.round(nutrition.protein)}g</span>
        <span className="text-muted-foreground">Carbs</span>
        <span>{Math.round(nutrition.carbs)}g</span>
        <span className="text-muted-foreground">Fat</span>
        <span>{Math.round(nutrition.fat)}g</span>
      </div>
    </div>
  )
}
