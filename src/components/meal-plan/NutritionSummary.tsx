import { Body } from '@/components/ui/typography'
import type { NutritionData, MealComponent } from './types'

interface NutritionSummaryProps {
  nutrition: NutritionData
  compact?: boolean
  components?: Pick<MealComponent, 'isVague'>[]
}

function hasVagueIngredients(components?: Pick<MealComponent, 'isVague'>[]): boolean {
  return components?.some((c) => c.isVague) ?? false
}

export function NutritionSummary({ nutrition, compact, components }: NutritionSummaryProps) {
  const hasVague = hasVagueIngredients(components)

  if (compact) {
    return (
      <div className="text-muted-foreground text-xs">
        {Math.round(nutrition.calories)} kcal · {Math.round(nutrition.protein)}g protein ·{' '}
        {Math.round(nutrition.carbs)}g carbs · {Math.round(nutrition.fat)}g fat
        {hasVague && '*'}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Body variant="small" className="font-semibold">
        Nutrition (per serving){hasVague && '*'}
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
      {hasVague && (
        <Body variant="muted" className="text-xs">
          *includes estimates for vague quantities
        </Body>
      )}
    </div>
  )
}
