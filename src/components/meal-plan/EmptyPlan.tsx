'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { GeneratingOverlay } from './GeneratingOverlay'
import {
  getNextMonday,
  getCurrentWeekMonday,
  isSunday,
  formatDateDisplay,
} from '@/lib/meal-planning/dates'
import type { WeekContext, HouseholdPreferencesData, DietaryType, Allergen } from './types'

const CLIENT_TIMEOUT_MS = 45000

type GenerateMode = 'generate' | 'empty'
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

function getErrorMessage(status: number, message?: string): string {
  switch (status) {
    case 429:
      return 'Rate limit exceeded. Please try again later.'
    case 409:
      return 'A meal plan already exists for this week.'
    case 422:
      return message || 'Could not generate a meal plan. Please try again.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

function getDefaultWeekType(): 'current' | 'next' {
  if (isSunday()) {
    return 'next'
  }
  return 'current'
}

function getEndDate(startDate: Date): Date {
  const end = new Date(startDate)
  end.setDate(end.getDate() + 6)
  return end
}

interface EmptyPlanProps {
  weekContext: WeekContext
  isFirstGeneration?: boolean
  preferences?: HouseholdPreferencesData
  timezone?: string
}

export function EmptyPlan({
  weekContext,
  isFirstGeneration = false,
  preferences,
  timezone: _timezone,
}: EmptyPlanProps) {
  const router = useRouter()
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // First-time form state — pre-filled from saved preferences
  const [selectedWeekType, setSelectedWeekType] = useState<'current' | 'next'>(getDefaultWeekType)
  const [mealTypes, setMealTypes] = useState<MealType[]>(() => {
    // Use weekday meal types from preferences as the unified selection
    const prefsWeekday = preferences?.weekdayMealTypes ?? []
    return prefsWeekday.length > 0 ? (prefsWeekday as MealType[]) : ['dinner']
  })
  const [dietaryType, setDietaryType] = useState<DietaryType | 'none'>(
    preferences?.dietaryType ?? 'none',
  )
  const [allergensToAvoid, setAllergensToAvoid] = useState<Allergen[]>(
    preferences?.allergensToAvoid ?? [],
  )
  const [restrictionsText, setRestrictionsText] = useState(
    (preferences?.restrictions ?? []).join(', '),
  )

  const startDate = selectedWeekType === 'current' ? getCurrentWeekMonday() : getNextMonday()
  const endDate = getEndDate(startDate)
  const canSelectCurrentWeek = !isSunday()

  const handleMealTypeToggle = (mealType: MealType, checked: boolean) => {
    if (checked) {
      setMealTypes([...mealTypes, mealType])
    } else {
      setMealTypes(mealTypes.filter((m) => m !== mealType))
    }
  }

  const handleAllergenToggle = (allergen: Allergen, checked: boolean) => {
    if (checked) {
      setAllergensToAvoid([...allergensToAvoid, allergen])
    } else {
      setAllergensToAvoid(allergensToAvoid.filter((a) => a !== allergen))
    }
  }

  const handleGenerate = async (mode: GenerateMode) => {
    setIsGenerating(true)
    setError(null)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

    try {
      // For first-time generation, save preferences first
      if (isFirstGeneration && mode === 'generate') {
        const restrictions = restrictionsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)

        const prefsResponse = await fetch('/api/households/me/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dietaryType: dietaryType === 'none' ? null : dietaryType,
            allergensToAvoid,
            restrictions,
            // For first-time, set both weekday and weekend to the same meal types
            weekdayMealTypes: mealTypes,
            weekendMealTypes: mealTypes,
          }),
          signal: controller.signal,
        })

        if (!prefsResponse.ok) {
          const data = await prefsResponse.json().catch(() => ({}))
          throw {
            status: prefsResponse.status,
            message: data.message || 'Failed to save preferences',
          }
        }
      }

      // Determine target week for generation
      const targetWeek = isFirstGeneration ? selectedWeekType : weekContext.type

      const response = await fetch('/api/meal-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetWeek, mode }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw { status: response.status, message: data.message }
      }

      setIsGenerating(false)
      router.refresh()
    } catch (err) {
      clearTimeout(timeoutId)
      setIsGenerating(false)

      if (err instanceof Error && err.name === 'AbortError') {
        setError('Generation timed out. Please try again.')
        return
      }

      if (typeof err === 'object' && err !== null && 'status' in err) {
        const e = err as { status: number; message?: string }
        setError(getErrorMessage(e.status, e.message))
        return
      }

      setError('Something went wrong. Please try again.')
    }
  }

  // First-time generation: full combined screen
  if (isFirstGeneration) {
    return (
      <>
        {isGenerating && <GeneratingOverlay />}
        <div className="mx-auto max-w-lg">
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-2 text-center">
              <Heading variant="h2">Set up your first meal plan</Heading>
              <Body variant="muted">
                Configure your preferences and generate your first weekly meal plan.
              </Body>
            </div>

            {/* Start date */}
            <section className="flex flex-col gap-3">
              <Label className="text-base font-semibold">Start date</Label>
              <div className="flex gap-2">
                {canSelectCurrentWeek && (
                  <Button
                    type="button"
                    variant={selectedWeekType === 'current' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedWeekType('current')}
                    disabled={isGenerating}
                  >
                    This week
                  </Button>
                )}
                <Button
                  type="button"
                  variant={selectedWeekType === 'next' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedWeekType('next')}
                  disabled={isGenerating}
                >
                  Next week
                </Button>
              </div>
              <Body variant="muted">
                {formatDateDisplay(startDate)} — {formatDateDisplay(endDate)}
              </Body>
            </section>

            {/* Meals to plan */}
            <section className="flex flex-col gap-3">
              <Label className="text-base font-semibold">Meals to plan</Label>
              <div className="flex flex-wrap gap-4">
                {MEAL_TYPES.map((meal) => (
                  <div key={meal.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`meal-${meal.value}`}
                      checked={mealTypes.includes(meal.value)}
                      onCheckedChange={(checked) =>
                        handleMealTypeToggle(meal.value, checked === true)
                      }
                      disabled={isGenerating}
                    />
                    <Label htmlFor={`meal-${meal.value}`} className="font-normal">
                      {meal.label}
                    </Label>
                  </div>
                ))}
              </div>
            </section>

            {/* Dietary needs */}
            <section className="flex flex-col gap-4">
              <Label className="text-base font-semibold">Dietary needs</Label>

              {/* Dietary type */}
              <div className="flex flex-col gap-2">
                <Label>Dietary type</Label>
                <RadioGroup
                  value={dietaryType}
                  onValueChange={(value) => setDietaryType(value as DietaryType | 'none')}
                  disabled={isGenerating}
                  className="flex flex-wrap gap-x-4 gap-y-2"
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

              {/* Allergens */}
              <div className="flex flex-col gap-2">
                <Label>Allergens to avoid</Label>
                <Body variant="muted">
                  Selected allergens will be completely excluded from your meal plans
                </Body>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {ALLERGENS.map((allergen) => (
                    <div key={allergen.value} className="flex items-center gap-2">
                      <Checkbox
                        id={`allergen-${allergen.value}`}
                        checked={allergensToAvoid.includes(allergen.value)}
                        onCheckedChange={(checked) =>
                          handleAllergenToggle(allergen.value, checked === true)
                        }
                        disabled={isGenerating}
                      />
                      <Label htmlFor={`allergen-${allergen.value}`} className="font-normal">
                        {allergen.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Restrictions */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="restrictions">Anything else?</Label>
                <Textarea
                  id="restrictions"
                  value={restrictionsText}
                  onChange={(e) => setRestrictionsText(e.target.value)}
                  placeholder="e.g., low FODMAP, no spicy food, halal"
                  disabled={isGenerating}
                  rows={2}
                />
                <Body variant="muted">Comma-separated dietary restrictions or preferences</Body>
              </div>
            </section>

            {/* Error */}
            {error && (
              <Body variant="small" className="text-destructive">
                {error}
              </Body>
            )}

            {/* CTA */}
            <div className="flex flex-col items-center gap-3">
              <Button
                onClick={() => handleGenerate('generate')}
                disabled={isGenerating || mealTypes.length === 0}
                size="lg"
                className="w-full"
              >
                {isGenerating ? 'Generating...' : 'Generate meal plan'}
              </Button>
            </div>
          </div>
        </div>
      </>
    )
  }

  // Returning generation: simplified UI
  const isCurrentWeek = weekContext.type === 'current'
  const heading = isCurrentWeek ? 'No meal plan for this week' : 'No meal plan for next week'
  const description = isCurrentWeek
    ? weekContext.isPartialWeek
      ? `Generate a plan for the remaining ${weekContext.daysCount} days of this week.`
      : 'Generate your meal plan for this week to get started.'
    : 'Generate your meal plan for next week.'
  const buttonText = isCurrentWeek ? 'Generate this week' : 'Generate next week'

  return (
    <>
      {isGenerating && <GeneratingOverlay />}
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Heading variant="h2">{heading}</Heading>
          <Body variant="muted">{description}</Body>
        </div>
        {error && (
          <Body variant="small" className="text-destructive">
            {error}
          </Body>
        )}
        <div className="flex flex-col items-center gap-3">
          <Button onClick={() => handleGenerate('generate')} disabled={isGenerating}>
            {isGenerating ? 'Generating...' : buttonText}
          </Button>
          <button
            onClick={() => handleGenerate('empty')}
            disabled={isGenerating}
            className="text-muted-foreground hover:text-foreground text-sm underline disabled:opacity-50"
          >
            or create empty week
          </button>
        </div>
      </div>
    </>
  )
}
