'use client'

import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Body, Heading } from '@/components/ui/typography'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { TagInput, type TagInputRef } from '@/components/tag-input'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { Member, DietaryType, Allergen } from '@/types/member'

const DIETARY_TYPES: { value: DietaryType; label: string }[] = [
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

interface EditMemberPreferencesDialogProps {
  member: Member | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (member: Member) => void
  householdDietaryType: DietaryType | null
  isManualMember: boolean
}

export function EditMemberPreferencesDialog({
  member,
  open,
  onOpenChange,
  onSaved,
  householdDietaryType,
  isManualMember,
}: EditMemberPreferencesDialogProps) {
  // Member name (only for manual members)
  const [name, setName] = useState('')

  // Preferences state
  const [displayName, setDisplayName] = useState('')
  const [portionMultiplier, setPortionMultiplier] = useState(1.0)
  const [portionError, setPortionError] = useState<string | null>(null)
  const [targetCalories, setTargetCalories] = useState<number | null>(null)
  const [targetProtein, setTargetProtein] = useState<number | null>(null)
  const [targetCarbs, setTargetCarbs] = useState<number | null>(null)
  const [targetFat, setTargetFat] = useState<number | null>(null)
  const [dietaryType, setDietaryType] = useState<DietaryType | 'household'>('household')
  const [allergens, setAllergens] = useState<Allergen[]>([])
  const [restrictions, setRestrictions] = useState<string[]>([])
  const [excludedIngredients, setExcludedIngredients] = useState<string[]>([])

  // Collapsible state
  const [nutritionOpen, setNutritionOpen] = useState(false)

  // Refs for tag inputs
  const restrictionsRef = useRef<TagInputRef>(null)
  const excludedIngredientsRef = useRef<TagInputRef>(null)

  // Form state
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Reset form when member changes
  useEffect(() => {
    if (member) {
      setName(member.name || '')
      setDisplayName(member.preferences?.displayName || '')
      setPortionMultiplier(member.preferences?.portionMultiplier || 1.0)
      setTargetCalories(member.preferences?.targetCalories ?? null)
      setTargetProtein(member.preferences?.targetProtein ?? null)
      setTargetCarbs(member.preferences?.targetCarbs ?? null)
      setTargetFat(member.preferences?.targetFat ?? null)
      setDietaryType(member.preferences?.dietaryType || 'household')
      setAllergens((member.preferences?.allergens as Allergen[]) || [])
      setRestrictions(member.preferences?.restrictions || [])
      setExcludedIngredients(member.preferences?.excludedIngredients || [])
      setError('')
      setPortionError(null)
      // Open nutrition section if any target is set
      setNutritionOpen(
        member.preferences?.targetCalories != null ||
          member.preferences?.targetProtein != null ||
          member.preferences?.targetCarbs != null ||
          member.preferences?.targetFat != null,
      )
    }
  }, [member])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!member) return

    // Commit any pending tag input values before submitting
    restrictionsRef.current?.commitPendingValue()
    excludedIngredientsRef.current?.commitPendingValue()

    setError('')
    setIsLoading(true)

    try {
      const payload: Record<string, unknown> = {
        preferences: {
          displayName: displayName || null,
          portionMultiplier,
          targetCalories,
          targetProtein,
          targetCarbs,
          targetFat,
          dietaryType: dietaryType === 'household' ? null : dietaryType,
          allergens,
          restrictions,
          excludedIngredients,
        },
      }

      // Only include name for manual members
      const trimmedName = name.trim()
      if (isManualMember && trimmedName) {
        payload.name = trimmedName
      }

      const response = await fetch(`/api/households/me/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save preferences')
      }

      const updatedMember = await response.json()
      onSaved(updatedMember)
      onOpenChange(false)
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

  const toggleAllergen = (allergen: Allergen) => {
    setAllergens((prev) =>
      prev.includes(allergen) ? prev.filter((a) => a !== allergen) : [...prev, allergen],
    )
  }

  const memberDisplayName =
    member?.preferences?.displayName || member?.user?.name || member?.name || 'member'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit preferences for {memberDisplayName}</DialogTitle>
            <DialogDescription>
              Update dietary preferences and portion sizes for this member.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-6 py-4">
            {/* Member name (only for manual members) */}
            {isManualMember && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  placeholder="Enter name"
                  disabled={isLoading}
                />
              </div>
            )}

            {/* Display name */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={50}
                placeholder="e.g., Mom, Dad, Alex"
                disabled={isLoading}
              />
              <Body variant="muted" className="text-sm">
                How this member appears in the household
              </Body>
            </div>

            {/* Portion size */}
            <div className="flex flex-col gap-2">
              <Label>Portion size</Label>
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
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0.5}
                  max={3.0}
                  step={0.05}
                  value={portionMultiplier}
                  onChange={handlePortionInputChange}
                  className="w-24"
                  disabled={isLoading}
                  aria-invalid={!!portionError}
                />
                <Body variant="muted">x standard portion</Body>
              </div>
              {portionError && (
                <Body variant="small" className="text-destructive">
                  {portionError}
                </Body>
              )}
            </div>

            {/* Nutritional targets (Collapsible) */}
            <Collapsible open={nutritionOpen} onOpenChange={setNutritionOpen}>
              <div className="flex flex-col gap-2">
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
                <Body variant="muted" className="text-sm">
                  Optional daily nutrition goals
                </Body>
                <CollapsibleContent>
                  <div className="flex flex-col gap-4 pt-2">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="edit-targetCalories">Daily calories</Label>
                      <Input
                        id="edit-targetCalories"
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
                      <Body variant="muted" className="text-sm">
                        Leave empty to use default (2000 kcal × portion size)
                      </Body>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="edit-targetProtein">Protein (g)</Label>
                        <Input
                          id="edit-targetProtein"
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
                        <Body variant="muted" className="text-sm">
                          Default: 50g × portion
                        </Body>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="edit-targetCarbs">Carbs (g)</Label>
                        <Input
                          id="edit-targetCarbs"
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
                        <Label htmlFor="edit-targetFat">Fat (g)</Label>
                        <Input
                          id="edit-targetFat"
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
              </div>
            </Collapsible>

            {/* Dietary type */}
            <div className="flex flex-col gap-2">
              <Label>Dietary type</Label>
              <RadioGroup
                value={dietaryType}
                onValueChange={(value) => setDietaryType(value as DietaryType | 'household')}
                disabled={isLoading}
                className="flex flex-wrap gap-3"
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
            </div>

            {/* Allergens */}
            <div className="flex flex-col gap-2">
              <Label>Allergens</Label>
              <Body variant="muted" className="text-sm">
                Select any food allergies
              </Body>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ALLERGENS.map((allergen) => (
                  <div key={allergen.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`allergen-${allergen.value}`}
                      checked={allergens.includes(allergen.value)}
                      onCheckedChange={() => toggleAllergen(allergen.value)}
                      disabled={isLoading}
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
              <Label htmlFor="edit-restrictions">Dietary restrictions</Label>
              <TagInput
                ref={restrictionsRef}
                id="edit-restrictions"
                value={restrictions}
                onChange={setRestrictions}
                placeholder="e.g., low sodium, no spicy"
                disabled={isLoading}
              />
              <Body variant="muted" className="text-sm">
                Type a restriction and press Enter or click away to add
              </Body>
            </div>

            {/* Excluded ingredients */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-excludedIngredients">Excluded ingredients</Label>
              <TagInput
                ref={excludedIngredientsRef}
                id="edit-excludedIngredients"
                value={excludedIngredients}
                onChange={setExcludedIngredients}
                placeholder="e.g., cilantro, olives"
                disabled={isLoading}
              />
              <Body variant="muted" className="text-sm">
                Ingredients this member dislikes
              </Body>
            </div>

            {error && (
              <Body variant="small" className="text-destructive">
                {error}
              </Body>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save preferences'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
