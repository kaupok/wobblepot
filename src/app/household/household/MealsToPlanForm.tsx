'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { MEAL_TYPE_VALUES } from '@/components/household/meal-form-types'
import { SettingsSection } from './SettingsSection'
import type { HouseholdPreferencesValues, MealType } from './settings-values'

function MealTypeCheckbox({
  mealType,
  idPrefix,
  checked,
  disabled,
  onCheckedChange,
}: {
  mealType: MealType
  idPrefix: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const id = `${idPrefix}-${mealType}`
  const label = useEnumLabel('MealType', mealType)
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  )
}

type MealsValues = Pick<HouseholdPreferencesValues, 'weekdayMealTypes' | 'weekendMealTypes'>

interface MealsToPlanFormProps {
  preferences: HouseholdPreferencesValues | null
  isOwner: boolean
}

/**
 * Meals to plan: the weekday and weekend meal types. Saves those two fields to
 * `/api/households/me/preferences`, leaving the food preferences alone.
 */
export function MealsToPlanForm({ preferences, isOwner }: MealsToPlanFormProps) {
  const tSettings = useTranslations('household.settings')

  const [saved, setSaved] = useState<MealsValues>({
    weekdayMealTypes: preferences?.weekdayMealTypes ?? ['dinner'],
    weekendMealTypes: preferences?.weekendMealTypes ?? ['dinner'],
  })
  const [weekdayMealTypes, setWeekdayMealTypes] = useState<MealType[]>(saved.weekdayMealTypes)
  const [weekendMealTypes, setWeekendMealTypes] = useState<MealType[]>(saved.weekendMealTypes)

  const toggle = (setter: typeof setWeekdayMealTypes, mealType: MealType) => (checked: boolean) =>
    setter((current) => (checked ? [...current, mealType] : current.filter((m) => m !== mealType)))

  const groups = [
    {
      key: 'weekday',
      label: tSettings('weekdayMealsLabel'),
      value: weekdayMealTypes,
      setter: setWeekdayMealTypes,
    },
    {
      key: 'weekend',
      label: tSettings('weekendMealsLabel'),
      value: weekendMealTypes,
      setter: setWeekendMealTypes,
    },
  ]

  return (
    <SettingsSection
      id="meals"
      heading={tSettings('mealsHeading')}
      url="/api/households/me/preferences"
      isOwner={isOwner}
      values={{ weekdayMealTypes, weekendMealTypes }}
      saved={saved}
      onSaved={setSaved}
    >
      {({ disabled, errorId }) =>
        groups.map(({ key, label, value, setter }) => (
          <div key={key} className="flex flex-col gap-2">
            <Label id={`${key}-meals-label`}>{label}</Label>
            <div
              role="group"
              aria-labelledby={`${key}-meals-label`}
              aria-describedby={errorId}
              className="flex gap-4"
            >
              {MEAL_TYPE_VALUES.map((mealType) => (
                <MealTypeCheckbox
                  key={mealType}
                  mealType={mealType}
                  idPrefix={key}
                  checked={value.includes(mealType)}
                  disabled={disabled}
                  onCheckedChange={toggle(setter, mealType)}
                />
              ))}
            </div>
          </div>
        ))
      }
    </SettingsSection>
  )
}
