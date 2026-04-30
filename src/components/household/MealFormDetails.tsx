'use client'

import { useTranslations } from 'next-intl'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Heading } from '@/components/ui/typography'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { type MealTypeValue, MEAL_TYPE_VALUES } from './meal-form-types'

function MealTypeCheckboxRow({
  value,
  checked,
  disabled,
  onCheckedChange,
}: {
  value: MealTypeValue
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const label = useEnumLabel('MealType', value)
  const id = `mealtype-${value}`
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  )
}

interface MealFormDetailsProps {
  suitableFor: MealTypeValue[]
  onMealTypeToggle: (mealType: MealTypeValue, checked: boolean) => void
  timeMinutes: string
  onTimeMinutesChange: (value: string) => void
  kidFriendly: boolean
  onKidFriendlyChange: (checked: boolean) => void
  disabled: boolean
}

export function MealFormDetails({
  suitableFor,
  onMealTypeToggle,
  timeMinutes,
  onTimeMinutesChange,
  kidFriendly,
  onKidFriendlyChange,
  disabled,
}: MealFormDetailsProps) {
  const t = useTranslations('recipes.form.details')

  return (
    <section className="flex flex-col gap-4">
      <Heading variant="h4">{t('heading')}</Heading>

      <div className="flex flex-col gap-2">
        <Label>{t('suitableForLabel')}</Label>
        <div className="flex gap-4">
          {MEAL_TYPE_VALUES.map((mealType) => (
            <MealTypeCheckboxRow
              key={mealType}
              value={mealType}
              checked={suitableFor.includes(mealType)}
              disabled={disabled}
              onCheckedChange={(checked) => onMealTypeToggle(mealType, checked === true)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="timeMinutes">{t('timeMinutesLabel')}</Label>
        <Input
          id="timeMinutes"
          type="text"
          inputMode="numeric"
          value={timeMinutes}
          onChange={(e) => onTimeMinutesChange(e.target.value)}
          disabled={disabled}
          placeholder={t('timeMinutesPlaceholder')}
        />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="kidFriendly"
          checked={kidFriendly}
          onCheckedChange={(checked) => onKidFriendlyChange(checked === true)}
          disabled={disabled}
        />
        <Label htmlFor="kidFriendly" className="font-normal">
          {t('kidFriendlyLabel')}
        </Label>
      </div>
    </section>
  )
}
