'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Heading } from '@/components/ui/typography'
import { type MealTypeValue, MEAL_TYPES } from './meal-form-types'

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
  return (
    <section className="flex flex-col gap-4">
      <Heading variant="h4">Additional details</Heading>

      <div className="flex flex-col gap-2">
        <Label>Suitable for</Label>
        <div className="flex gap-4">
          {MEAL_TYPES.map((mealType) => (
            <div key={mealType.value} className="flex items-center gap-2">
              <Checkbox
                id={`mealtype-${mealType.value}`}
                checked={suitableFor.includes(mealType.value)}
                onCheckedChange={(checked) => onMealTypeToggle(mealType.value, checked === true)}
                disabled={disabled}
              />
              <Label htmlFor={`mealtype-${mealType.value}`} className="font-normal">
                {mealType.label}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="timeMinutes">Prep time (minutes)</Label>
        <Input
          id="timeMinutes"
          type="number"
          value={timeMinutes}
          onChange={(e) => onTimeMinutesChange(e.target.value)}
          min={1}
          max={480}
          disabled={disabled}
          placeholder="e.g., 30"
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
          Kid-friendly
        </Label>
      </div>
    </section>
  )
}
