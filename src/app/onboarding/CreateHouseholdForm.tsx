'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'

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

const TOTAL_STEPS = 4

interface CreateHouseholdFormProps {
  userName: string
}

type PortionType = 'adult' | 'child'

interface MemberRow {
  name: string
  portionType: PortionType
}

export function CreateHouseholdForm({ userName }: CreateHouseholdFormProps) {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(1)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  // Guard against race condition when transitioning from step 3 to 4
  // where Enter key event can inadvertently submit the form
  const [justTransitioned, setJustTransitioned] = useState(false)

  // Clear transition guard after 100ms, with cleanup to prevent memory leak
  useEffect(() => {
    if (justTransitioned) {
      const timeoutId = setTimeout(() => setJustTransitioned(false), 100)
      return () => clearTimeout(timeoutId)
    }
  }, [justTransitioned])

  // Step 1: Household name
  const [name, setName] = useState(`${userName}'s Household`)

  // Step 2: Meal types
  const [weekdayMealTypes, setWeekdayMealTypes] = useState<MealType[]>(['dinner'])
  const [weekendMealTypes, setWeekendMealTypes] = useState<MealType[]>(['dinner'])

  // Step 3: Dietary preferences
  const [dietaryType, setDietaryType] = useState<DietaryType | 'none'>('none')
  const [allergensToAvoid, setAllergensToAvoid] = useState<Allergen[]>([])

  // Step 4: Members
  const [householdSize, setHouseholdSize] = useState(1)
  const [memberRows, setMemberRows] = useState<MemberRow[]>([
    { name: userName, portionType: 'adult' },
  ])

  const handleMealTypeToggle = (mealType: MealType, checked: boolean, isWeekend: boolean) => {
    const setter = isWeekend ? setWeekendMealTypes : setWeekdayMealTypes
    const current = isWeekend ? weekendMealTypes : weekdayMealTypes

    if (checked) {
      setter([...current, mealType])
    } else {
      setter(current.filter((m) => m !== mealType))
    }
  }

  const handleAllergenToggle = (allergen: Allergen, checked: boolean) => {
    if (checked) {
      setAllergensToAvoid([...allergensToAvoid, allergen])
    } else {
      setAllergensToAvoid(allergensToAvoid.filter((a) => a !== allergen))
    }
  }

  const handleHouseholdSizeChange = (newSize: number) => {
    const clampedSize = Math.max(1, Math.min(10, newSize))
    setHouseholdSize(clampedSize)

    setMemberRows((prev) => {
      if (clampedSize > prev.length) {
        // Add new rows with defaults
        const newRows = Array.from({ length: clampedSize - prev.length }, () => ({
          name: '',
          portionType: 'adult' as PortionType,
        }))
        return [...prev, ...newRows]
      }
      // Trim rows (keep first N, never remove row 0)
      return prev.slice(0, clampedSize)
    })
  }

  const handleMemberNameChange = (index: number, newName: string) => {
    setMemberRows((prev) => prev.map((row, i) => (i === index ? { ...row, name: newName } : row)))
  }

  const handlePortionTypeChange = (index: number, portionType: PortionType) => {
    setMemberRows((prev) => prev.map((row, i) => (i === index ? { ...row, portionType } : row)))
  }

  const generateDefaultName = (index: number, row: MemberRow): string => {
    if (row.name.trim()) return row.name.trim()

    // Count how many of this type come before this index (for numbering)
    let typeCount = 0
    for (let i = 0; i <= index; i++) {
      if (memberRows[i]?.portionType === row.portionType) {
        typeCount++
      }
    }

    const typeLabel = row.portionType === 'child' ? 'Child' : 'Adult'
    return `${typeLabel} ${typeCount}`
  }

  const handleNext = () => {
    setError('')

    if (currentStep === 1 && !name.trim()) {
      setError('Household name is required')
      return
    }

    if (currentStep < TOTAL_STEPS) {
      // Set transition guard to prevent race condition where Enter key
      // from "Continue" button inadvertently submits the form after
      // the submit button appears on step 4
      setJustTransitioned(true)
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    setError('')
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Ignore submissions triggered by race condition during step transition
    if (justTransitioned) {
      return
    }

    setError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/households', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          preferences: {
            dietaryType: dietaryType === 'none' ? null : dietaryType,
            allergensToAvoid,
            weekdayMealTypes,
            weekendMealTypes,
          },
          members: memberRows.slice(1).map((row, index) => ({
            name: generateDefaultName(index + 1, row),
            portionType: row.portionType,
          })),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (data.error === 'already_in_household') {
          router.push('/meal-plan')
          router.refresh()
          return
        }
        setError(data.message || data.error || 'Failed to create household')
        return
      }

      toast.success('Household created')
      router.push('/meal-plan')
      router.refresh()
    } catch {
      setError('Unable to connect. Please check your internet connection.')
    } finally {
      setIsLoading(false)
    }
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Household name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={isLoading}
                maxLength={100}
                autoFocus
              />
            </div>
          </div>
        )

      case 2:
        return (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <Label>Weekday meals</Label>
              <div className="flex flex-wrap gap-4">
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
            <div className="flex flex-col gap-3">
              <Label>Weekend meals</Label>
              <div className="flex flex-wrap gap-4">
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
          </div>
        )

      case 3:
        return (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <Label>Dietary type</Label>
              <RadioGroup
                value={dietaryType}
                onValueChange={(value) => setDietaryType(value as DietaryType | 'none')}
                disabled={isLoading}
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
            <div className="flex flex-col gap-3">
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
          </div>
        )

      case 4:
        return (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="householdSize">How many people in your household?</Label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleHouseholdSizeChange(householdSize - 1)}
                  disabled={isLoading || householdSize <= 1}
                  className="h-9 w-9 p-0"
                  aria-label="Decrease household size"
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Input
                  id="householdSize"
                  type="number"
                  min={1}
                  max={10}
                  value={householdSize}
                  onChange={(e) => handleHouseholdSizeChange(parseInt(e.target.value) || 1)}
                  disabled={isLoading}
                  className="w-16 text-center"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleHouseholdSizeChange(householdSize + 1)}
                  disabled={isLoading || householdSize >= 10}
                  className="h-9 w-9 p-0"
                  aria-label="Increase household size"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Label>Members</Label>
              <Body variant="muted">You can edit names and types later in settings.</Body>
              <div className="flex flex-col gap-2">
                {memberRows.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={row.name}
                      onChange={(e) => handleMemberNameChange(index, e.target.value)}
                      placeholder={generateDefaultName(index, row)}
                      disabled={isLoading || index === 0}
                      maxLength={100}
                      className="flex-1"
                      aria-label={`Member ${index + 1} name`}
                    />
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant={row.portionType === 'adult' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handlePortionTypeChange(index, 'adult')}
                        disabled={isLoading || index === 0}
                        className="h-9 px-3 text-xs"
                      >
                        Adult
                      </Button>
                      <Button
                        type="button"
                        variant={row.portionType === 'child' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handlePortionTypeChange(index, 'child')}
                        disabled={isLoading || index === 0}
                        className="h-9 px-3 text-xs"
                      >
                        Child
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  const getStepTitle = () => {
    switch (currentStep) {
      case 1:
        return 'Create your household'
      case 2:
        return 'Meals to plan'
      case 3:
        return 'Dietary preferences'
      case 4:
        return 'Household members'
      default:
        return ''
    }
  }

  const getStepDescription = () => {
    switch (currentStep) {
      case 1:
        return 'Give your household a name to get started'
      case 2:
        return 'Which meals do you want to plan?'
      case 3:
        return 'Help us find the right meals for you'
      case 4:
        return 'Tell us about your household'
      default:
        return ''
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="flex flex-col gap-2">
          <Body variant="muted">
            Step {currentStep} of {TOTAL_STEPS}
          </Body>
          <CardTitle>
            <Heading variant="h2">{getStepTitle()}</Heading>
          </CardTitle>
          <CardDescription>
            <Body variant="muted">{getStepDescription()}</Body>
          </CardDescription>
        </div>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          {renderStepContent()}
          {error && (
            <div className="mt-4">
              <Body variant="small" className="text-destructive" role="alert">
                {error}
              </Body>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-between gap-2 pt-6">
          {currentStep > 1 ? (
            <Button type="button" variant="outline" onClick={handleBack} disabled={isLoading}>
              Back
            </Button>
          ) : (
            <div />
          )}
          {currentStep < TOTAL_STEPS ? (
            <Button type="button" onClick={handleNext} disabled={isLoading}>
              Continue
            </Button>
          ) : (
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Creating...' : 'Create household'}
            </Button>
          )}
        </CardFooter>
      </form>
    </Card>
  )
}
