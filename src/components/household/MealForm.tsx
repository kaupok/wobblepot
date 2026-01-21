'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { Search, Plus, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { IngredientCategory, MealType, Unit } from '@/generated/prisma/enums'

type MealTypeValue = 'breakfast' | 'lunch' | 'dinner'

const MEAL_TYPES: { value: MealTypeValue; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
]

interface IngredientResult {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
}

interface MealComponent {
  ingredientId: string
  ingredient: IngredientResult
  totalQuantity: number
}

interface MealFormData {
  id?: string
  name: string
  description?: string | null
  timeMinutes?: number | null
  kidFriendly: boolean
  suitableFor: MealType[]
  servings?: number
  components: {
    ingredientId: string
    quantityPerServing: number
    ingredient: {
      id: string
      name: string
      category: IngredientCategory
      defaultUnit: Unit
    }
  }[]
}

interface MealFormProps {
  meal?: MealFormData
  onSuccess: () => void
  onCancel: () => void
}

function formatUnit(unit: Unit): string {
  return unit === 'g' ? 'g' : ''
}

function formatCategory(category: IngredientCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

export function MealForm({ meal, onSuccess, onCancel }: MealFormProps) {
  const isEditing = !!meal?.id

  // Form state
  const [name, setName] = useState(meal?.name ?? '')
  const [description, setDescription] = useState(meal?.description ?? '')
  const [timeMinutes, setTimeMinutes] = useState<string>(
    meal?.timeMinutes ? String(meal.timeMinutes) : '',
  )
  const [kidFriendly, setKidFriendly] = useState(meal?.kidFriendly ?? false)
  const [suitableFor, setSuitableFor] = useState<MealTypeValue[]>(
    (meal?.suitableFor as MealTypeValue[]) ?? ['dinner'],
  )
  const editServings = meal?.servings ?? 4
  const [servings, setServings] = useState<string>(String(editServings))
  const [components, setComponents] = useState<MealComponent[]>(() => {
    if (!meal?.components) return []
    // Convert from per-serving to total using actual servings count
    return meal.components.map((c) => ({
      ingredientId: c.ingredientId,
      ingredient: c.ingredient,
      totalQuantity: c.quantityPerServing * editServings,
    }))
  })

  // Ingredient search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<IngredientResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Search for ingredients
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!searchQuery.trim()) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true)
      try {
        const response = await fetch(
          `/api/ingredients?search=${encodeURIComponent(searchQuery.trim())}`,
        )
        if (response.ok) {
          const data = await response.json()
          setSearchResults(data.ingredients)
          setShowDropdown(data.ingredients.length > 0)
          setHighlightedIndex(-1)
        }
      } catch {
        // Ignore errors
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [searchQuery])

  const handleMealTypeToggle = (mealType: MealTypeValue, checked: boolean) => {
    if (checked) {
      setSuitableFor([...suitableFor, mealType])
    } else {
      const newTypes = suitableFor.filter((t) => t !== mealType)
      if (newTypes.length > 0) {
        setSuitableFor(newTypes)
      }
    }
  }

  const addIngredient = useCallback(
    (ingredient: IngredientResult) => {
      // Check if already added
      if (components.some((c) => c.ingredientId === ingredient.id)) {
        toast.error(`${ingredient.name} is already added`)
        return
      }

      setComponents([
        ...components,
        {
          ingredientId: ingredient.id,
          ingredient,
          totalQuantity: ingredient.defaultUnit === 'piece' ? 1 : 100,
        },
      ])
      setSearchQuery('')
      setShowDropdown(false)
      setSearchResults([])
    },
    [components],
  )

  const removeIngredient = (ingredientId: string) => {
    setComponents(components.filter((c) => c.ingredientId !== ingredientId))
  }

  const updateQuantity = (ingredientId: string, quantity: number) => {
    setComponents(
      components.map((c) =>
        c.ingredientId === ingredientId ? { ...c, totalQuantity: quantity } : c,
      ),
    )
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((prev) => Math.min(prev + 1, searchResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((prev) => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selectedResult = searchResults[highlightedIndex]
      if (highlightedIndex >= 0 && selectedResult) {
        addIngredient(selectedResult)
      } else if (searchResults.length === 1 && searchResults[0]) {
        addIngredient(searchResults[0])
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
      setHighlightedIndex(-1)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validation
    if (!name.trim()) {
      setError('Name is required')
      return
    }

    if (suitableFor.length === 0) {
      setError('Select at least one meal type')
      return
    }

    const servingsNum = parseInt(servings, 10)
    if (isNaN(servingsNum) || servingsNum < 1) {
      setError('Servings must be at least 1')
      return
    }

    if (components.length === 0) {
      setError('Add at least one ingredient')
      return
    }

    // Validate all quantities are positive
    const invalidComponent = components.find((c) => c.totalQuantity <= 0)
    if (invalidComponent) {
      setError(`Quantity for ${invalidComponent.ingredient.name} must be greater than 0`)
      return
    }

    setIsSubmitting(true)

    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        timeMinutes: timeMinutes ? parseInt(timeMinutes, 10) : null,
        kidFriendly,
        suitableFor,
        servings: servingsNum,
        components: components.map((c) => ({
          ingredientId: c.ingredientId,
          totalQuantity: c.totalQuantity,
        })),
      }

      const url = isEditing ? `/api/households/me/meals/${meal.id}` : '/api/households/me/meals'
      const method = isEditing ? 'PATCH' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || `Failed to ${isEditing ? 'update' : 'create'} meal`)
      }

      toast.success(isEditing ? 'Meal updated' : 'Meal created')
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Calculate per-serving preview
  const servingsNum = parseInt(servings, 10) || 1

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>
          <Heading variant="h2">{isEditing ? 'Edit meal' : 'Create meal'}</Heading>
        </CardTitle>
        <CardDescription>
          <Body variant="muted">
            {isEditing
              ? 'Update your custom meal details'
              : 'Add a new meal to your household collection'}
          </Body>
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <div className="flex flex-col gap-6">
            {/* Basic Info Section */}
            <section className="flex flex-col gap-4">
              <Heading variant="h4">Basic information</Heading>

              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Meal name</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  required
                  disabled={isSubmitting}
                  placeholder="e.g., Chicken stir fry"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={1000}
                  disabled={isSubmitting}
                  placeholder="Brief description of the meal..."
                  rows={2}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label>Suitable for</Label>
                <div className="flex gap-4">
                  {MEAL_TYPES.map((meal) => (
                    <div key={meal.value} className="flex items-center gap-2">
                      <Checkbox
                        id={`mealtype-${meal.value}`}
                        checked={suitableFor.includes(meal.value)}
                        onCheckedChange={(checked) =>
                          handleMealTypeToggle(meal.value, checked === true)
                        }
                        disabled={isSubmitting}
                      />
                      <Label htmlFor={`mealtype-${meal.value}`} className="font-normal">
                        {meal.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="timeMinutes">Prep time (minutes)</Label>
                  <Input
                    id="timeMinutes"
                    type="number"
                    value={timeMinutes}
                    onChange={(e) => setTimeMinutes(e.target.value)}
                    min={1}
                    max={480}
                    disabled={isSubmitting}
                    placeholder="e.g., 30"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="servings">Recipe makes (servings)</Label>
                  <Input
                    id="servings"
                    type="number"
                    value={servings}
                    onChange={(e) => setServings(e.target.value)}
                    min={1}
                    max={50}
                    required
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="kidFriendly"
                  checked={kidFriendly}
                  onCheckedChange={(checked) => setKidFriendly(checked === true)}
                  disabled={isSubmitting}
                />
                <Label htmlFor="kidFriendly" className="font-normal">
                  Kid-friendly
                </Label>
              </div>
            </section>

            {/* Ingredients Section */}
            <section className="flex flex-col gap-4">
              <Heading variant="h4">Ingredients</Heading>
              <Body variant="muted">
                Enter the total quantity needed for the entire recipe ({servingsNum} servings). We
                will calculate per-serving amounts automatically.
              </Body>

              {/* Ingredient search */}
              <div className="relative">
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <Input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => {
                      if (searchResults.length > 0) {
                        setShowDropdown(true)
                      }
                    }}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Search ingredients..."
                    className="pr-9 pl-9"
                    disabled={isSubmitting}
                  />
                  {isSearching && (
                    <Loader2 className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
                  )}
                </div>

                {showDropdown && searchResults.length > 0 && (
                  <div
                    ref={dropdownRef}
                    className="bg-popover absolute top-full z-10 mt-1 w-full rounded-md border shadow-md"
                  >
                    {searchResults.map((ingredient, index) => {
                      const isAdded = components.some((c) => c.ingredientId === ingredient.id)
                      return (
                        <button
                          key={ingredient.id}
                          type="button"
                          onClick={() => addIngredient(ingredient)}
                          disabled={isSubmitting || isAdded}
                          className={cn(
                            'flex w-full items-center justify-between px-3 py-2 text-left transition-colors',
                            'hover:bg-muted focus:bg-muted focus:outline-none',
                            index > 0 && 'border-t',
                            highlightedIndex === index && 'bg-muted',
                            isAdded && 'opacity-50',
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Body className={isAdded ? 'text-muted-foreground' : undefined}>
                              {ingredient.name}
                            </Body>
                            <Body variant="muted">({formatCategory(ingredient.category)})</Body>
                          </div>
                          {isAdded ? (
                            <Body variant="muted">Added</Body>
                          ) : (
                            <Plus className="text-muted-foreground h-4 w-4" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                {searchQuery.trim() && !isSearching && searchResults.length === 0 && (
                  <div className="bg-popover absolute top-full z-10 mt-1 w-full rounded-md border p-3 shadow-md">
                    <Body variant="muted" className="text-center">
                      No ingredients found
                    </Body>
                  </div>
                )}
              </div>

              {/* Added ingredients */}
              {components.length > 0 && (
                <div className="flex flex-col gap-2">
                  {components.map((comp) => (
                    <div
                      key={comp.ingredientId}
                      className="flex items-center gap-3 rounded-md border p-3"
                    >
                      <div className="flex-1">
                        <Body>{comp.ingredient.name}</Body>
                        <Body variant="muted">
                          {Math.round((comp.totalQuantity / servingsNum) * 10) / 10}
                          {formatUnit(comp.ingredient.defaultUnit)} per serving
                        </Body>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={comp.totalQuantity}
                          onChange={(e) =>
                            updateQuantity(comp.ingredientId, parseFloat(e.target.value) || 0)
                          }
                          min={0.1}
                          step={comp.ingredient.defaultUnit === 'piece' ? 1 : 10}
                          className="w-24"
                          disabled={isSubmitting}
                        />
                        <Body variant="muted">{formatUnit(comp.ingredient.defaultUnit)}</Body>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeIngredient(comp.ingredientId)}
                          disabled={isSubmitting}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {components.length === 0 && (
                <div className="border-muted rounded-md border border-dashed p-6 text-center">
                  <Body variant="muted">No ingredients added yet. Search above to add some.</Body>
                </div>
              )}
            </section>

            {/* Per-Serving Preview */}
            {components.length > 0 && (
              <section className="flex flex-col gap-2">
                <Heading variant="h4">Per serving</Heading>
                <div className="flex flex-wrap gap-2">
                  {components.map((comp) => (
                    <Badge key={comp.ingredientId} variant="secondary">
                      {comp.ingredient.name}:{' '}
                      {Math.round((comp.totalQuantity / servingsNum) * 10) / 10}
                      {formatUnit(comp.ingredient.defaultUnit)}
                    </Badge>
                  ))}
                </div>
              </section>
            )}
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <div className="flex w-full flex-col gap-4">
            {error && (
              <Body variant="small" className="text-destructive" role="alert">
                {error}
              </Body>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isSubmitting}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="flex-1">
                {isSubmitting ? 'Saving...' : isEditing ? 'Update meal' : 'Create meal'}
              </Button>
            </div>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
