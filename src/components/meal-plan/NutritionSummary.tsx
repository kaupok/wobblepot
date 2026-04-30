import { useTranslations } from 'next-intl'
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
  const t = useTranslations('meal-plan.nutrition')
  const hasVague = hasVagueIngredients(components)

  if (compact) {
    return (
      <div className="text-muted-foreground text-xs">
        {Math.round(nutrition.calories)} kcal · {Math.round(nutrition.protein)}g{' '}
        {t('compact.protein')} · {Math.round(nutrition.carbs)}g {t('compact.carbs')} ·{' '}
        {Math.round(nutrition.fat)}g {t('compact.fat')}
        {hasVague && '*'}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Body variant="small" className="font-semibold">
        {t('summaryHeader')}
        {hasVague && '*'}
      </Body>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">{t('calories')}</span>
        <span>{Math.round(nutrition.calories)} kcal</span>
        <span className="text-muted-foreground">{t('protein')}</span>
        <span>{Math.round(nutrition.protein)}g</span>
        <span className="text-muted-foreground">{t('carbs')}</span>
        <span>{Math.round(nutrition.carbs)}g</span>
        <span className="text-muted-foreground">{t('fat')}</span>
        <span>{Math.round(nutrition.fat)}g</span>
      </div>
      {hasVague && <Body variant="caption">{t('vagueDisclaimer')}</Body>}
    </div>
  )
}
