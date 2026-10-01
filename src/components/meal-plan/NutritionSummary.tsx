import { useLocale, useTranslations } from 'next-intl'
import { InfoTip } from '@/components/ui/info-tip'
import { Body } from '@/components/ui/typography'
import { formatInteger } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'
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
  const locale = useLocale() as Locale
  const hasVague = hasVagueIngredients(components)

  // A vague quantity ("to taste") makes the numbers an estimate. One (i) button
  // says so in both layouts, after the macros (compact) or the header (full),
  // and a meal without one shows nothing (HON-764, HON-930).
  const vagueInfo = hasVague && (
    <InfoTip label={t('vagueInfoLabel')} size={compact ? 'sm' : 'default'}>
      {t('vagueInfo')}
    </InfoTip>
  )

  if (compact) {
    return (
      <div className="text-muted-foreground flex items-center gap-1 text-xs">
        <span>
          {formatInteger(nutrition.calories, locale)} kcal ·{' '}
          {formatInteger(nutrition.protein, locale)}g {t('compact.protein')} ·{' '}
          {formatInteger(nutrition.carbs, locale)}g {t('compact.carbs')} ·{' '}
          {formatInteger(nutrition.fat, locale)}g {t('compact.fat')}
        </span>
        {vagueInfo}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <Body variant="small">{t('summaryHeader')}</Body>
        {vagueInfo}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">{t('calories')}</span>
        <span>{formatInteger(nutrition.calories, locale)} kcal</span>
        <span className="text-muted-foreground">{t('protein')}</span>
        <span>{formatInteger(nutrition.protein, locale)}g</span>
        <span className="text-muted-foreground">{t('carbs')}</span>
        <span>{formatInteger(nutrition.carbs, locale)}g</span>
        <span className="text-muted-foreground">{t('fat')}</span>
        <span>{formatInteger(nutrition.fat, locale)}g</span>
      </div>
    </div>
  )
}
