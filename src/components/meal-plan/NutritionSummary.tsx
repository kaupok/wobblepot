'use client'

import { useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { InfoTip } from '@/components/ui/info-tip'
import { Body } from '@/components/ui/typography'
import { formatInteger } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'
import { cn } from '@/lib/utils'
import { MACROS, macroEnergyShares, macroSplitStyle, type Macro } from './macro-energy-shares'
import type { NutritionData, MealComponent } from './types'
import { useMacroLabelsFit } from './use-macro-labels-fit'

export type NutritionSummarySize = 'default' | 'lg'

interface NutritionSummaryProps {
  nutrition: NutritionData
  /** `lg` in the cook view, read at arm's length; `default` on cards and in the recipe form. */
  size?: NutritionSummarySize
  components?: Pick<MealComponent, 'isVague'>[]
}

/** The ordinal series token for each macro's part and swatch (globals.css). */
const PART_FILL: Record<Macro, string> = {
  protein: 'bg-series-1',
  carbs: 'bg-series-2',
  fat: 'bg-series-3',
}

const SIZE = {
  default: { value: 'small', bar: 'h-1.5', gap: 'gap-2', rowGap: 'gap-y-2' },
  lg: { value: 'large', bar: 'h-3', gap: 'gap-3', rowGap: 'gap-y-3' },
} as const satisfies Record<NutritionSummarySize, Record<string, string>>

/** Outer ends of the bar fully rounded, the corners between parts barely. */
function partShape(index: number, count: number): string {
  if (count === 1) return 'rounded-full'
  if (index === 0) return 'rounded-l-full rounded-r-xs'
  if (index === count - 1) return 'rounded-l-xs rounded-r-full'
  return 'rounded-xs'
}

function hasVagueIngredients(components?: Pick<MealComponent, 'isVague'>[]): boolean {
  return components?.some((c) => c.isVague) ?? false
}

/**
 * A meal's nutrition per serving (HON-1109): the calories, one bar split by
 * each macro's share of the energy (protein, carbs, fat), and each macro's
 * grams over its name.
 *
 * The legend sits under its own parts when every label fits its part
 * ("aligned"), so the bar and its numbers read as one object. When a label is
 * wider than its part — Estonian "Süsivesikud" over 22%, carbs at 4% in a
 * low-carb meal — the legend pins to the start, middle and end of the row
 * instead, with a swatch before each name ("pinned"). The bar is decoration:
 * every value is in the text, in reading order.
 */
export function NutritionSummary({
  nutrition,
  size = 'default',
  components,
}: NutritionSummaryProps) {
  const t = useTranslations('meal-plan.nutrition')
  const locale = useLocale() as Locale
  const rootRef = useRef<HTMLDivElement>(null)
  const sizing = SIZE[size]

  const grams: Record<Macro, number> = {
    protein: nutrition.protein,
    carbs: nutrition.carbs,
    fat: nutrition.fat,
  }
  const shares = macroEnergyShares(grams)
  const formatted = MACROS.map((macro) => formatInteger(grams[macro], locale))
  // A macro shown as "0g" has no part and no gap.
  const drawn = MACROS.filter((macro) => Math.round(grams[macro]) > 0)
  const drawnShares = drawn.map((macro) => shares[macro])
  // Aligned needs a part over every label.
  const canAlign = drawn.length === MACROS.length
  const fits = useMacroLabelsFit(
    rootRef,
    canAlign,
    `${drawnShares.join()}|${locale}|${formatted.join()}`,
  )
  const aligned = canAlign && fits

  // A vague quantity ("to taste") makes the numbers an estimate. One (i)
  // button after "per serving" says so, and a meal without one shows nothing
  // (HON-764, HON-930).
  const vagueInfo = hasVagueIngredients(components) && (
    <InfoTip label={t('vagueInfoLabel')} size="sm">
      {t('vagueInfo')}
    </InfoTip>
  )

  // `w-max` on the grams and the name, so the fit check reads their text's
  // width rather than their column's.
  const legendItem = (macro: Macro, index: number, swatch: boolean) => (
    <div key={macro} data-macro={macro} className="flex flex-col gap-1">
      <Body variant={sizing.value} data-macro-text={macro} className="w-max">
        {t('grams', { value: formatted[index]! })}
      </Body>
      <div className="flex items-center gap-1.5">
        {swatch && (
          <span aria-hidden className={cn('size-2.5 shrink-0 rounded-xs', PART_FILL[macro])} />
        )}
        <Body variant="caption" data-macro-text={macro} className="w-max">
          {t(macro)}
        </Body>
      </div>
    </div>
  )

  return (
    <div
      ref={rootRef}
      data-size={size}
      data-mode={aligned ? 'aligned' : 'pinned'}
      className={cn('flex flex-col tabular-nums', sizing.gap)}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Body variant={sizing.value}>
          {t('kcal', { calories: formatInteger(nutrition.calories, locale) })}
        </Body>
        <div className="flex items-center gap-1">
          <Body variant="caption">{t('perServing')}</Body>
          {vagueInfo}
        </div>
      </div>

      {drawn.length > 0 && (
        <div
          data-testid="macro-split"
          className={cn('grid-cols-macro-split grid gap-x-0.5', sizing.rowGap)}
          // eslint-disable-next-line shadcn/no-inline-styles -- --macro-split is the bar's data-driven column template, read by the grid-cols-macro-split @utility in globals.css; it sets no colour or type.
          style={macroSplitStyle(drawnShares)}
        >
          {drawn.map((macro, index) => (
            <div
              key={macro}
              aria-hidden
              data-macro-part={macro}
              className={cn(sizing.bar, PART_FILL[macro], partShape(index, drawn.length))}
            />
          ))}
          {aligned && MACROS.map((macro, index) => legendItem(macro, index, false))}
        </div>
      )}

      {!aligned && (
        <div className="flex justify-between gap-2">
          {MACROS.map((macro, index) => legendItem(macro, index, drawn.length > 0))}
        </div>
      )}
    </div>
  )
}
