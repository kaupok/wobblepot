'use client'

import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
 * The caption beside the calories opens a list of members, and picking one
 * multiplies the per-serving values by their portion (HON-1505). The view opens
 * on the signed-in member's portion when it is not 1×. With every member at 1×
 * each option would repeat "Per serving", so the caption is plain text.
 */
export function PortionNutrition({ nutrition, portions, size, components }: PortionNutritionProps) {
  const t = useTranslations('meal-plan.nutrition')
  // The user's pick; until they make one, the default follows the members as they load.
  const [choice, setChoice] = useState<string | null>(null)
  const labelId = useId()
  const valueId = useId()

  const showChoice = !!portions?.some((portion) => portion.multiplier !== 1)
  if (!portions || !showChoice) {
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
    <NutritionSummary
      nutrition={shown}
      size={size}
      components={components}
      caption={
        <Select value={selected ? selected.id : PER_SERVING} onValueChange={setChoice}>
          {/* The name is "Whose portion" and the current caption, so a screen
              reader hears both the question and the answer. */}
          <span id={labelId} className="sr-only">
            {t('portionGroupLabel')}
          </span>
          <SelectTrigger variant="inline" aria-labelledby={`${labelId} ${valueId}`}>
            <SelectValue id={valueId}>
              {selected
                ? t('memberCaption', { name: selected.name, multiplier: selected.multiplier })
                : t('perServing')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PER_SERVING} size="lg">
              {t('perServingChip')}
            </SelectItem>
            {portions.map((portion) => (
              <SelectItem key={portion.id} value={portion.id} size="lg">
                {t('memberChip', { name: portion.name, multiplier: portion.multiplier })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}
