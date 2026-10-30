'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { ChoiceChips } from '@/components/ui/choice-chips'
import type { MemberPortion } from '@/hooks/use-member-portions'

import { NutritionSummary, type NutritionSummarySize } from './NutritionSummary'
import type { MealComponent, NutritionData } from './types'

const PER_SERVING = 'per-serving'

interface PortionNutritionProps {
  /** One serving, which is a 1× portion: the household's servings sum the members' portions. */
  nutrition: NutritionData
  /** `undefined` while the members load, on an error, or where there is no household. */
  portions?: MemberPortion[]
  size?: NutritionSummarySize
  components?: Pick<MealComponent, 'isVague'>[]
}

/**
 * The cook view's nutrition, per serving or for one member's plate (HON-1475).
 * A chip per member multiplies the per-serving values by their portion. The
 * view opens on the signed-in member's chip when their portion is not 1×. With
 * every member at 1× each chip would repeat "Per serving", so there are none.
 */
export function PortionNutrition({ nutrition, portions, size, components }: PortionNutritionProps) {
  const t = useTranslations('meal-plan.nutrition')
  // The user's pick; until they make one, the default follows the members as they load.
  const [choice, setChoice] = useState<string | null>(null)

  const showChips = !!portions?.some((portion) => portion.multiplier !== 1)
  if (!portions || !showChips) {
    return <NutritionSummary nutrition={nutrition} size={size} components={components} />
  }

  const own = portions.find((portion) => portion.isSelf && portion.multiplier !== 1)
  const selectedId = choice ?? own?.id ?? PER_SERVING
  const selected = portions.find((portion) => portion.id === selectedId)
  const shown: NutritionData = selected
    ? {
        calories: nutrition.calories * selected.multiplier,
        protein: nutrition.protein * selected.multiplier,
        carbs: nutrition.carbs * selected.multiplier,
        fat: nutrition.fat * selected.multiplier,
      }
    : nutrition

  return (
    <div className="flex flex-col gap-3">
      <ChoiceChips
        aria-label={t('portionGroupLabel')}
        value={selected ? selected.id : PER_SERVING}
        onValueChange={setChoice}
        options={[
          { value: PER_SERVING, label: t('perServingChip') },
          ...portions.map((portion) => ({
            value: portion.id,
            label: t('memberChip', { name: portion.name, multiplier: portion.multiplier }),
          })),
        ]}
      />
      <NutritionSummary
        nutrition={shown}
        size={size}
        components={components}
        caption={
          selected
            ? t('memberCaption', { name: selected.name, multiplier: selected.multiplier })
            : undefined
        }
      />
    </div>
  )
}
