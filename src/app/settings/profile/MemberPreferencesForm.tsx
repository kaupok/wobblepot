'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Heading, Body } from '@/components/ui/typography'
import { TagInput } from '@/components/tag-input'
import { SettingsNav } from '@/components/settings-nav'
import { cn } from '@/lib/utils'

type DietaryType = 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian'

const DIETARY_TYPES: { value: DietaryType; label: string }[] = [
  { value: 'omnivore', label: 'Omnivore' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'pescatarian', label: 'Pescatarian' },
]

const PORTION_PRESETS = [
  { label: 'Small', value: 0.75 },
  { label: 'Regular', value: 1.0 },
  { label: 'Large', value: 1.5 },
  { label: 'Extra large', value: 2.0 },
]

interface MemberPreferencesFormProps {
  preferences: {
    displayName: string | null
    portionMultiplier: number
    targetCalories: number | null
    targetProtein: number | null
    targetCarbs: number | null
    targetFat: number | null
    dietaryType: DietaryType | null
    restrictions: string[]
    excludedIngredients: string[]
  }
  householdDietaryType: DietaryType | null
}

export function MemberPreferencesForm({
  preferences,
  householdDietaryType,
}: MemberPreferencesFormProps) {
  // Basic info state
  const [displayName, setDisplayName] = useState(preferences.displayName ?? '')

  // Portion size state
  const [portionMultiplier, setPortionMultiplier] = useState(preferences.portionMultiplier)
  const [portionError, setPortionError] = useState<string | null>(null)

  // Nutritional targets state
  const [targetCalories, setTargetCalories] = useState<number | null>(preferences.targetCalories)
  const [targetProtein, setTargetProtein] = useState<number | null>(preferences.targetProtein)
  const [targetCarbs, setTargetCarbs] = useState<number | null>(preferences.targetCarbs)
  const [targetFat, setTargetFat] = useState<number | null>(preferences.targetFat)

  // Dietary preferences state
  const [dietaryType, setDietaryType] = useState<DietaryType | 'household'>(
    preferences.dietaryType ?? 'household',
  )
  const [restrictions, setRestrictions] = useState<string[]>(preferences.restrictions)
  const [excludedIngredients, setExcludedIngredients] = useState<string[]>(
    preferences.excludedIngredients,
  )

  // Form state
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Collapsible state - open by default if any nutritional target is set
  const [nutritionOpen, setNutritionOpen] = useState(
    preferences.targetCalories !== null ||
      preferences.targetProtein !== null ||
      preferences.targetCarbs !== null ||
      preferences.targetFat !== null,
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const payload = {
        displayName: displayName || null,
        portionMultiplier,
        targetCalories,
        targetProtein,
        targetCarbs,
        targetFat,
        dietaryType: dietaryType === 'household' ? null : dietaryType,
        restrictions,
        excludedIngredients,
      }

      const response = await fetch('/api/members/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save preferences')
      }

      toast.success('Preferences saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const handlePortionInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    if (isNaN(value)) {
      setPortionError(null)
      return
    }
    if (value < 0.5 || value > 3.0) {
      setPortionError('Portion size must be between 0.5 and 3.0')
      return
    }
    setPortionError(null)
    setPortionMultiplier(Math.round(value * 100) / 100)
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>
          <Heading variant="h2">My preferences</Heading>
        </CardTitle>
        <CardDescription>
          <Body variant="muted">Set your personal dietary needs and portion sizes</Body>
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <div className="flex flex-col gap-8">
            <SettingsNav />

            {/* Section 1: Display Name */}
            <section className="flex flex-col gap-4">
              <Heading variant="h4">Display name</Heading>
              <div className="flex flex-col gap-2">
                <Label htmlFor="displayName">How you appear in the household</Label>
                <Input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={50}
                  placeholder="e.g., Mom, Dad, Alex"
                  disabled={isLoading}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'form-error' : undefined}
                />
              </div>
            </section>

            {/* Section 2: Portion Size */}
            <section className="flex flex-col gap-4">
              <Heading variant="h4">Portion size</Heading>
              <Body variant="muted">
                Adjust your typical portion size relative to standard recipes
              </Body>
              <div className="flex flex-wrap gap-2">
                {PORTION_PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant={portionMultiplier === preset.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPortionMultiplier(preset.value)}
                    disabled={isLoading}
                  >
                    {preset.label} ({preset.value}x)
                  </Button>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="portionMultiplier">Custom multiplier</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="portionMultiplier"
                    type="number"
                    min={0.5}
                    max={3.0}
                    step={0.05}
                    value={portionMultiplier}
                    onChange={handlePortionInputChange}
                    className="w-24"
                    disabled={isLoading}
                    aria-invalid={!!portionError}
                    aria-describedby={portionError ? 'portion-error' : undefined}
                  />
                  <Body variant="muted">× standard portion</Body>
                </div>
                {portionError && (
                  <Body
                    id="portion-error"
                    variant="small"
                    className="text-destructive"
                    role="alert"
                  >
                    {portionError}
                  </Body>
                )}
              </div>
            </section>

            {/* Section 3: Nutritional Targets (Collapsible) */}
            <Collapsible open={nutritionOpen} onOpenChange={setNutritionOpen}>
              <section className="flex flex-col gap-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left"
                  >
                    <Heading variant="h4">Nutritional targets</Heading>
                    <ChevronDown
                      className={cn('h-5 w-5 transition-transform', nutritionOpen && 'rotate-180')}
                    />
                  </button>
                </CollapsibleTrigger>
                <Body variant="muted">
                  Set optional daily nutrition goals for personalized meal suggestions
                </Body>
                <CollapsibleContent>
                  <div className="flex flex-col gap-4 pt-2">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="targetCalories">Daily calories</Label>
                      <Input
                        id="targetCalories"
                        type="number"
                        min={500}
                        max={5000}
                        value={targetCalories ?? ''}
                        onChange={(e) =>
                          setTargetCalories(e.target.value ? parseInt(e.target.value) : null)
                        }
                        placeholder="e.g., 2000"
                        disabled={isLoading}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="targetProtein">Protein (g)</Label>
                        <Input
                          id="targetProtein"
                          type="number"
                          min={0}
                          max={500}
                          value={targetProtein ?? ''}
                          onChange={(e) =>
                            setTargetProtein(e.target.value ? parseInt(e.target.value) : null)
                          }
                          placeholder="e.g., 150"
                          disabled={isLoading}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="targetCarbs">Carbs (g)</Label>
                        <Input
                          id="targetCarbs"
                          type="number"
                          min={0}
                          max={500}
                          value={targetCarbs ?? ''}
                          onChange={(e) =>
                            setTargetCarbs(e.target.value ? parseInt(e.target.value) : null)
                          }
                          placeholder="e.g., 250"
                          disabled={isLoading}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="targetFat">Fat (g)</Label>
                        <Input
                          id="targetFat"
                          type="number"
                          min={0}
                          max={500}
                          value={targetFat ?? ''}
                          onChange={(e) =>
                            setTargetFat(e.target.value ? parseInt(e.target.value) : null)
                          }
                          placeholder="e.g., 65"
                          disabled={isLoading}
                        />
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </section>
            </Collapsible>

            {/* Section 4: Dietary Type */}
            <section className="flex flex-col gap-4">
              <Heading variant="h4">Dietary type</Heading>
              <Body variant="muted">
                Your personal dietary type. This overrides the household setting
                {householdDietaryType && ` (${householdDietaryType})`} for your meal suggestions.
              </Body>
              <RadioGroup
                value={dietaryType}
                onValueChange={(value) => setDietaryType(value as DietaryType | 'household')}
                disabled={isLoading}
                className="flex flex-wrap gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="household" id="dietary-household" />
                  <Label htmlFor="dietary-household" className="font-normal">
                    Use household setting
                    {householdDietaryType && ` (${householdDietaryType})`}
                  </Label>
                </div>
                {DIETARY_TYPES.map((type) => (
                  <div key={type.value} className="flex items-center gap-2">
                    <RadioGroupItem value={type.value} id={`dietary-${type.value}`} />
                    <Label htmlFor={`dietary-${type.value}`} className="font-normal">
                      {type.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </section>

            {/* Section 5: Personal Restrictions */}
            <section className="flex flex-col gap-4">
              <Heading variant="h4">Personal restrictions</Heading>
              <div className="flex flex-col gap-2">
                <Label htmlFor="restrictions">Dietary restrictions</Label>
                <TagInput
                  id="restrictions"
                  value={restrictions}
                  onChange={setRestrictions}
                  placeholder="e.g., low sodium, no spicy"
                  disabled={isLoading}
                />
                <Body variant="muted">Add personal dietary restrictions (press Enter to add)</Body>
              </div>
            </section>

            {/* Section 6: Excluded Ingredients */}
            <section className="flex flex-col gap-4">
              <Heading variant="h4">Excluded ingredients</Heading>
              <div className="flex flex-col gap-2">
                <Label htmlFor="excludedIngredients">Ingredients to avoid</Label>
                <TagInput
                  id="excludedIngredients"
                  value={excludedIngredients}
                  onChange={setExcludedIngredients}
                  placeholder="e.g., cilantro, olives"
                  disabled={isLoading}
                />
                <Body variant="muted">
                  Add ingredients you personally dislike (press Enter to add)
                </Body>
              </div>
            </section>
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <div className="flex w-full flex-col gap-4">
            {error && (
              <Body id="form-error" variant="small" className="text-destructive" role="alert">
                {error}
              </Body>
            )}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save preferences'}
            </Button>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
