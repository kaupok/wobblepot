'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Heading, Body } from '@/components/ui/typography'
import { TagInput, type TagInputRef } from '@/components/tag-input'

// Types matching Prisma enums
type DietaryType = 'vegetarian' | 'vegan' | 'pescatarian'
type Allergen =
  | 'gluten'
  | 'dairy'
  | 'eggs'
  | 'nuts'
  | 'peanuts'
  | 'soy'
  | 'fish'
  | 'shellfish'
  | 'sesame'
type MealType = 'breakfast' | 'lunch' | 'dinner'

const DIETARY_TYPES: { value: DietaryType | 'none'; label: string }[] = [
  { value: 'none', label: 'No preference' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'pescatarian', label: 'Pescatarian' },
]

const ALLERGENS: { value: Allergen; label: string }[] = [
  { value: 'gluten', label: 'Gluten' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'eggs', label: 'Eggs' },
  { value: 'nuts', label: 'Tree nuts' },
  { value: 'peanuts', label: 'Peanuts' },
  { value: 'soy', label: 'Soy' },
  { value: 'fish', label: 'Fish' },
  { value: 'shellfish', label: 'Shellfish' },
  { value: 'sesame', label: 'Sesame' },
]

const MEAL_TYPES: { value: MealType; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
]

// Get all IANA timezones
const TIMEZONES = Intl.supportedValuesOf('timeZone')

interface HouseholdSettingsFormProps {
  household: {
    id: string
    name: string
    timezone: string
  }
  preferences: {
    dietaryType: DietaryType | null
    allergensToAvoid: Allergen[]
    restrictions: string[]
    excludedIngredients: string[]
    weekdayMealTypes: MealType[]
    weekendMealTypes: MealType[]
  } | null
  isOwner: boolean
}

export function HouseholdSettingsForm({
  household,
  preferences,
  isOwner,
}: HouseholdSettingsFormProps) {
  // Basic info state
  const [name, setName] = useState(household.name)
  const [timezone, setTimezone] = useState(household.timezone)

  // Preferences state
  const [dietaryType, setDietaryType] = useState<DietaryType | 'none'>(
    preferences?.dietaryType ?? 'none',
  )
  const [allergensToAvoid, setAllergensToAvoid] = useState<Allergen[]>(
    preferences?.allergensToAvoid ?? [],
  )
  const [restrictions, setRestrictions] = useState<string[]>(preferences?.restrictions ?? [])
  const [excludedIngredients, setExcludedIngredients] = useState<string[]>(
    preferences?.excludedIngredients ?? [],
  )
  const [weekdayMealTypes, setWeekdayMealTypes] = useState<MealType[]>(
    preferences?.weekdayMealTypes ?? ['dinner'],
  )
  const [weekendMealTypes, setWeekendMealTypes] = useState<MealType[]>(
    preferences?.weekendMealTypes ?? ['dinner'],
  )

  // Refs for tag inputs
  const restrictionsRef = useRef<TagInputRef>(null)
  const excludedIngredientsRef = useRef<TagInputRef>(null)

  // Form state
  const [error, setError] = useState('')

  const saveSettings = useMutation({
    mutationFn: async () => {
      const preferencesPayload = {
        dietaryType: dietaryType === 'none' ? null : dietaryType,
        allergensToAvoid,
        restrictions,
        excludedIngredients,
        weekdayMealTypes,
        weekendMealTypes,
      }

      const requests: Promise<Response>[] = [
        fetch('/api/households/me/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(preferencesPayload),
        }),
      ]

      if (isOwner) {
        requests.unshift(
          fetch('/api/households/me', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, timezone }),
          }),
        )
      }

      const responses = await Promise.all(requests)

      for (const response of responses) {
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to save settings')
        }
      }
    },
    onSuccess: () => {
      toast.success('Settings saved')
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'An error occurred')
    },
  })

  const isLoading = saveSettings.isPending

  const handleAllergenToggle = (allergen: Allergen, checked: boolean) => {
    if (checked) {
      setAllergensToAvoid([...allergensToAvoid, allergen])
    } else {
      setAllergensToAvoid(allergensToAvoid.filter((a) => a !== allergen))
    }
  }

  const handleMealTypeToggle = (mealType: MealType, checked: boolean, isWeekend: boolean) => {
    const setter = isWeekend ? setWeekendMealTypes : setWeekdayMealTypes
    const current = isWeekend ? weekendMealTypes : weekdayMealTypes

    if (checked) {
      setter([...current, mealType])
    } else {
      setter(current.filter((m) => m !== mealType))
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Commit any pending tag input values before submitting
    restrictionsRef.current?.commitPendingValue()
    excludedIngredientsRef.current?.commitPendingValue()

    setError('')
    saveSettings.mutate()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Heading variant="h2">Household settings</Heading>
        <Body variant="muted">Configure your household preferences for meal planning</Body>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-8">
          {/* Section 1: Basic Info */}
          <section className="flex flex-col gap-4">
            <Heading variant="h4">Basic information</Heading>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Household name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
                disabled={isLoading || !isOwner}
                aria-invalid={!!error}
                aria-describedby={error ? 'form-error' : undefined}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone} disabled={isLoading || !isOwner}>
                <SelectTrigger
                  id="timezone"
                  className="w-full"
                  aria-invalid={!!error}
                  aria-describedby={error ? 'form-error' : undefined}
                >
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!isOwner && (
              <Body variant="muted">Only the household owner can edit name and timezone.</Body>
            )}
          </section>

          {/* Section 2: Dietary Preferences */}
          <section className="flex flex-col gap-4">
            <Heading variant="h4">Dietary preferences</Heading>
            <div className="flex flex-col gap-2">
              <Label>Dietary type</Label>
              <RadioGroup
                value={dietaryType}
                onValueChange={(value) => setDietaryType(value as DietaryType | 'none')}
                disabled={isLoading}
                className="flex flex-wrap gap-4"
              >
                {DIETARY_TYPES.map((type) => (
                  <div key={type.value} className="flex items-center gap-2">
                    <RadioGroupItem value={type.value} id={`dietary-${type.value}`} />
                    <Label htmlFor={`dietary-${type.value}`} className="font-normal">
                      {type.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Allergens to avoid</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ALLERGENS.map((allergen) => (
                  <div key={allergen.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`allergen-${allergen.value}`}
                      checked={allergensToAvoid.includes(allergen.value)}
                      onCheckedChange={(checked) =>
                        handleAllergenToggle(allergen.value, checked === true)
                      }
                      disabled={isLoading}
                    />
                    <Label htmlFor={`allergen-${allergen.value}`} className="font-normal">
                      {allergen.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="restrictions">Dietary restrictions</Label>
              <TagInput
                ref={restrictionsRef}
                id="restrictions"
                value={restrictions}
                onChange={setRestrictions}
                placeholder="e.g., low sodium, halal"
                disabled={isLoading}
              />
              <Body variant="muted">Type a restriction and press Enter or click away to add</Body>
            </div>
          </section>

          {/* Section 3: Excluded Ingredients */}
          <section className="flex flex-col gap-4">
            <Heading variant="h4">Excluded ingredients</Heading>
            <div className="flex flex-col gap-2">
              <Label htmlFor="excluded">Ingredients to exclude</Label>
              <TagInput
                ref={excludedIngredientsRef}
                id="excluded"
                value={excludedIngredients}
                onChange={setExcludedIngredients}
                placeholder="e.g., cilantro, mushrooms"
                disabled={isLoading}
              />
              <Body variant="muted">Ingredients you want to avoid in meal suggestions</Body>
            </div>
          </section>

          {/* Section 4: Meal Scheduling */}
          <section className="flex flex-col gap-4">
            <Heading variant="h4">Meal scheduling</Heading>
            <div className="flex flex-col gap-2">
              <Label>Weekday meals to plan</Label>
              <div className="flex gap-4">
                {MEAL_TYPES.map((meal) => (
                  <div key={meal.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`weekday-${meal.value}`}
                      checked={weekdayMealTypes.includes(meal.value)}
                      onCheckedChange={(checked) =>
                        handleMealTypeToggle(meal.value, checked === true, false)
                      }
                      disabled={isLoading}
                    />
                    <Label htmlFor={`weekday-${meal.value}`} className="font-normal">
                      {meal.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Weekend meals to plan</Label>
              <div className="flex gap-4">
                {MEAL_TYPES.map((meal) => (
                  <div key={meal.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`weekend-${meal.value}`}
                      checked={weekendMealTypes.includes(meal.value)}
                      onCheckedChange={(checked) =>
                        handleMealTypeToggle(meal.value, checked === true, true)
                      }
                      disabled={isLoading}
                    />
                    <Label htmlFor={`weekend-${meal.value}`} className="font-normal">
                      {meal.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Submit */}
          <div className="flex flex-col gap-4 pt-2">
            {error && (
              <Body id="form-error" variant="small" className="text-destructive" role="alert">
                {error}
              </Body>
            )}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save settings'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
