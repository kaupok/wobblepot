'use client'

import { useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { InfoTip } from '@/components/ui/info-tip'
import { Body } from '@/components/ui/typography'
import { formatInteger } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'
import { cn } from '@/lib/utils'
import {
  MACROS,
  macroCarbsStyle,
  macroEnergyShares,
  macroSplitStyle,
  type Macro,
} from './macro-energy-shares'
import type { NutritionData, MealComponent } from './types'
import { useMacroLegendPlacement } from './use-macro-legend-placement'

export type NutritionSummarySize = 'default' | 'lg'

interface NutritionSummaryProps {
  nutrition: NutritionData
  /** `lg` in the cook view, read at arm's length; `default` on cards and in the recipe form. */
  size?: NutritionSummarySize
  components?: Pick<MealComponent, 'isVague'>[]
}

/** The ordinal series token for each macro's part of the bar (globals.css). */
const PART_FILL: Record<Macro, string> = {
  protein: 'bg-series-1',
  carbs: 'bg-series-2',
  fat: 'bg-series-3',
}

/** Protein starts the row and Fat ends it; only Carbs moves. */
const LABEL_ALIGN: Record<Macro, string> = {
  protein: 'items-start text-left',
  carbs: 'items-center text-center',
  fat: 'items-end text-right',
}

const SIZE = {
  default: { value: 'small', grams: 'figure-small', gap: 'gap-1.5' },
  lg: { value: 'large', grams: 'figure', gap: 'gap-2' },
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
 * Where Carbs centres before a browser measures (the server render): the
 * middle of its part, or the protein/fat boundary for a carbs part at 0g, as a
 * share of the row. The layout effect replaces it with px before paint.
 */
function estimatedCarbsCentre(shares: Record<Macro, number>): string {
  if (shares.protein + shares.carbs + shares.fat === 0) return '50%'
  return `${shares.protein + shares.carbs / 2}%`
}

/**
 * A meal's nutrition per serving (HON-1109, HON-1114): the calories with "per
 * serving" beside them, one bar split by each macro's share of the energy
 * (protein, carbs, fat), and each macro's grams over its name.
 *
 * One legend layout for every meal. Protein's part always starts the bar and
 * fat's always ends it, so Protein is flush left and Fat flush right. Carbs
 * centres under its own part and is clamped to keep 16px from both
 * (`useMacroLegendPlacement`). When the three labels and two gaps do not fit
 * the row (200% text zoom), the legend is a plain row instead. The bar is
 * decoration: every value is in the text, in reading order.
 */
export function NutritionSummary({
  nutrition,
  size = 'default',
  components,
}: NutritionSummaryProps) {
  const t = useTranslations('meal-plan.nutrition')
  const locale = useLocale() as Locale
  const rootRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
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
  const { carbsCentre, fallback } = useMacroLegendPlacement(
    rootRef,
    legendRef,
    `${drawnShares.join()}|${locale}|${formatted.join()}`,
  )

  // A vague quantity ("to taste") makes the numbers an estimate. One (i)
  // button after "per serving" says so, and a meal without one shows nothing
  // (HON-764, HON-930).
  const vagueInfo = hasVagueIngredients(components) && (
    <InfoTip label={t('vagueInfoLabel')} size="sm">
      {t('vagueInfo')}
    </InfoTip>
  )

  return (
    <div ref={rootRef} data-size={size} className={cn('flex flex-col tabular-nums', sizing.gap)}>
      <div className="flex items-baseline gap-2">
        <Body variant={sizing.value}>
          {t('kcal', { calories: formatInteger(nutrition.calories, locale) })}
        </Body>
        <div className="flex items-center gap-1">
          <Body variant="fine-print">{t('perServing')}</Body>
          {vagueInfo}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {drawn.length > 0 && (
          <div
            data-testid="macro-split"
            className="grid-cols-macro-split grid gap-x-0.5"
            // eslint-disable-next-line shadcn/no-inline-styles -- --macro-split is the bar's data-driven column template, read by the grid-cols-macro-split @utility in globals.css; it sets no colour or type.
            style={macroSplitStyle(drawnShares)}
          >
            {drawn.map((macro, index) => (
              <div
                key={macro}
                aria-hidden
                data-macro-part={macro}
                className={cn('h-1.5', PART_FILL[macro], partShape(index, drawn.length))}
              />
            ))}
          </div>
        )}

        {/* Protein and Fat are in flow at the row's ends and give it its
            height; Carbs sits over the row at its measured centre. In the
            fallback all three are in flow and the row wraps. `w-max` on each
            label, so its measured width is its text's wherever it sits. */}
        <div
          ref={legendRef}
          data-testid="macro-legend"
          data-fallback={fallback || undefined}
          className="relative flex flex-wrap justify-between gap-x-4 gap-y-1"
          // eslint-disable-next-line shadcn/no-inline-styles -- --macro-carbs-x is the Carbs label's data-driven centre, read by the left-macro-carbs @utility in globals.css; it sets no colour or type.
          style={macroCarbsStyle(
            carbsCentre === null ? estimatedCarbsCentre(shares) : `${carbsCentre}px`,
          )}
        >
          {MACROS.map((macro, index) => (
            <div
              key={macro}
              data-macro={macro}
              className={cn(
                'flex w-max flex-col gap-0.5',
                LABEL_ALIGN[macro],
                macro === 'carbs' &&
                  !fallback &&
                  'left-macro-carbs absolute top-0 -translate-x-1/2',
              )}
            >
              <Body variant={sizing.grams}>{t('grams', { value: formatted[index]! })}</Body>
              <Body variant="fine-print">{t(macro)}</Body>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
