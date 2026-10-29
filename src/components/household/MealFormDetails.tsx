'use client'

import { useTranslations } from 'next-intl'

import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Body, Heading } from '@/components/ui/typography'
import type { ProteinType } from '@/generated/prisma/enums'
import { useEnumLabel } from '@/lib/i18n/enum-label'

import { MEAL_TYPE_VALUES, type MealTypeValue } from './meal-form-types'
import type { MainProteinState } from './use-main-protein'

/** The Select's value for "no choice": Radix reserves the empty string. */
const AUTOMATIC = 'automatic'

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

function ProteinOption({ value }: { value: ProteinType }) {
  return <SelectItem value={value}>{useEnumLabel('ProteinType', value)}</SelectItem>
}

/**
 * "Main protein" (HON-1386): automatic first, labelled with the live derived
 * value, then each protein type the ingredients carry.
 */
function MainProteinSelect({
  mainProtein,
  disabled,
}: {
  mainProtein: MainProteinState
  disabled: boolean
}) {
  const t = useTranslations('recipes.form.details')
  const automaticLabel = useEnumLabel('ProteinType', mainProtein.automatic)
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="mainProtein">{t('mainProteinLabel')}</Label>
      <Body variant="muted" id="mainProtein-hint">
        {t('mainProteinHint')}
      </Body>
      <Select
        value={mainProtein.choice ?? AUTOMATIC}
        onValueChange={(value) =>
          mainProtein.setChoice(value === AUTOMATIC ? null : (value as ProteinType))
        }
        disabled={disabled}
      >
        <SelectTrigger id="mainProtein" className="w-full" aria-describedby="mainProtein-hint">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTOMATIC}>
            {t('mainProteinAutomatic', { protein: automaticLabel })}
          </SelectItem>
          {mainProtein.options.map((value) => (
            <ProteinOption key={value} value={value} />
          ))}
        </SelectContent>
      </Select>
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
  mainProtein: MainProteinState
  disabled: boolean
}

export function MealFormDetails({
  suitableFor,
  onMealTypeToggle,
  timeMinutes,
  onTimeMinutesChange,
  kidFriendly,
  onKidFriendlyChange,
  mainProtein,
  disabled,
}: MealFormDetailsProps) {
  const t = useTranslations('recipes.form.details')

  return (
    <section className="flex flex-col gap-4">
      <Heading variant="section" as="h2">
        {t('heading')}
      </Heading>

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

      {mainProtein.visible && <MainProteinSelect mainProtein={mainProtein} disabled={disabled} />}
    </section>
  )
}
