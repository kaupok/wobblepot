'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MEAL_TYPE_VALUES } from '@/components/household/meal-form-types'
import { SettingsSection } from './SettingsSection'
import type { HouseholdPreferencesValues, MealType } from './settings-values'

type MealsValues = Pick<HouseholdPreferencesValues, 'weekdayMealTypes' | 'weekendMealTypes'>

interface MealsToPlanFormProps {
  preferences: HouseholdPreferencesValues | null
  isOwner: boolean
}

/**
 * Meals to plan: the weekday and weekend meal types, as one grid with the
 * meals as columns and the two day groups as rows (HON-962). Saves those two
 * fields to `/api/households/me/preferences`, leaving the food preferences
 * alone.
 */
export function MealsToPlanForm({ preferences, isOwner }: MealsToPlanFormProps) {
  const tSettings = useTranslations('household.settings')
  const tMealType = useTranslations('enums.MealType')

  const [saved, setSaved] = useState<MealsValues>({
    weekdayMealTypes: preferences?.weekdayMealTypes ?? ['dinner'],
    weekendMealTypes: preferences?.weekendMealTypes ?? ['dinner'],
  })
  const [weekdayMealTypes, setWeekdayMealTypes] = useState<MealType[]>(saved.weekdayMealTypes)
  const [weekendMealTypes, setWeekendMealTypes] = useState<MealType[]>(saved.weekendMealTypes)

  const toggle = (setter: typeof setWeekdayMealTypes, mealType: MealType) => (checked: boolean) =>
    setter((current) => (checked ? [...current, mealType] : current.filter((m) => m !== mealType)))

  const rows = [
    {
      key: 'weekday',
      label: tSettings('weekdaysRow'),
      value: weekdayMealTypes,
      setter: setWeekdayMealTypes,
    },
    {
      key: 'weekend',
      label: tSettings('weekendsRow'),
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
      // The route needs at least one meal type for each (HON-961).
      validate={(values) =>
        values.weekdayMealTypes.length === 0 || values.weekendMealTypes.length === 0
          ? tSettings('mealsRequired')
          : undefined
      }
      onSaved={setSaved}
    >
      {({ disabled, errorId }) => (
        // As wide as its content, not the column: three checkboxes do not need
        // the form's width between them.
        <Table className="w-auto" aria-labelledby="meals-heading">
          <TableHeader>
            <TableRow>
              {/* The corner cell heads nothing, so it is a data cell: an empty
                  `th` reads as a missing header. */}
              <TableCell />
              {MEAL_TYPE_VALUES.map((mealType) => (
                <TableHead key={mealType} scope="col">
                  {tMealType(mealType)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ key, label, value, setter }) => (
              <TableRow key={key}>
                <TableHead scope="row">{label}</TableHead>
                {MEAL_TYPE_VALUES.map((mealType) => {
                  const id = `${key}-${mealType}`
                  return (
                    <TableCell key={mealType}>
                      {/* The label widens the tap area to the cell, 44px tall
                          on a phone; the checkbox names itself. */}
                      <label
                        htmlFor={id}
                        className="min-h-touch -m-2 flex items-center p-2 md:min-h-10"
                      >
                        <Checkbox
                          id={id}
                          // Both axes, so the name holds outside the table
                          // context: "Weekdays: Breakfast".
                          aria-label={tSettings('mealCellAria', {
                            day: label,
                            meal: tMealType(mealType),
                          })}
                          aria-describedby={errorId}
                          checked={value.includes(mealType)}
                          disabled={disabled}
                          onCheckedChange={(checked) => toggle(setter, mealType)(checked === true)}
                        />
                      </label>
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SettingsSection>
  )
}
