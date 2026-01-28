'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { Search, Plus, Loader2, ChevronDown, ChevronRight, Info } from 'lucide-react'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { IngredientRow, type IngredientRowData } from '@/components/recipes/IngredientRow'
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

interface IngredientAlternative {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
  similarity: number
}

// Internal component for resolved ingredients (matched, high-confidence)
interface MealComponent {
  ingredientId: string
  ingredient: IngredientResult
  totalQuantity: number
  isVague?: boolean
  originalPhrase?: string | null
}

// Enhanced prefilled data that includes match states
export interface PrefilledIngredient {
  type: 'matched' | 'low-confidence' | 'unmatched'
  // For matched and low-confidence
  ingredient?: {
    id: string
    name: string
    category: IngredientCategory
    defaultUnit: Unit
  }
  convertedQuantity?: number
  isVague?: boolean
  originalPhrase?: string | null
  // For low-confidence
  lowConfidence?: boolean
  alternatives?: IngredientAlternative[]
  extractedName?: string
  // For unmatched
  originalText?: string
  extractedQuantity?: number
  extractedUnit?: string
}

export interface MealFormData {
  id?: string
  name: string
  description?: string | null
  timeMinutes?: number | null
  kidFriendly: boolean
  suitableFor: MealType[]
  servings?: number
  // Standard components (for editing existing meals)
  components?: {
    ingredientId: string
    quantityPerServing: number
    isVague?: boolean
    originalPhrase?: string | null
    ingredient: {
      id: string
      name: string
      category: IngredientCategory
      defaultUnit: Unit
    }
  }[]
  // Enhanced prefilled ingredients (for recipe import with match states)
  prefilledIngredients?: PrefilledIngredient[]
  // Original recipe text (for import mode - allows user to reference while editing)
  originalRecipeText?: string
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

function formatIngredientList(names: string[], maxDisplay: number = 3): string {
  if (names.length <= maxDisplay) {
    return names.join(', ')
  }
  const displayed = names.slice(0, maxDisplay)
  const remaining = names.length - maxDisplay
  return `${displayed.join(', ')} +${remaining} more`
}

export function MealForm({ meal, onSuccess, onCancel }: MealFormProps) {
  const isEditing = !!meal?.id
  const hasPrefilledIngredients = !!meal?.prefilledIngredients?.length
  const originalRecipeText = meal?.originalRecipeText

  // Collapsible state for original recipe text
  const [isOriginalTextOpen, setIsOriginalTextOpen] = useState(false)

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

  // Standard components (for plain ingredient rows when editing)
  const [components, setComponents] = useState<MealComponent[]>(() => {
    if (!meal?.components) return []
    // Convert from per-serving to total using actual servings count
    return meal.components.map((c) => ({
      ingredientId: c.ingredientId,
      ingredient: c.ingredient,
      totalQuantity: c.quantityPerServing * editServings,
      isVague: c.isVague,
      originalPhrase: c.originalPhrase,
    }))
  })

  // Enhanced ingredient rows (for import flow with match states)
  // Sort by status: unmatched → low-confidence → matched (items needing attention first)
  const [ingredientRows, setIngredientRows] = useState<IngredientRowData[]>(() => {
    if (!meal?.prefilledIngredients) return []

    const rows = meal.prefilledIngredients.map((prefilled): IngredientRowData => {
      if (prefilled.type === 'unmatched') {
        return {
          type: 'unmatched',
          extractedName: prefilled.extractedName ?? '',
          originalText: prefilled.originalText ?? '',
          extractedQuantity: prefilled.extractedQuantity ?? 0,
          extractedUnit: prefilled.extractedUnit ?? '',
          isVague: prefilled.isVague,
          originalPhrase: prefilled.originalPhrase,
        }
      }

      if (prefilled.type === 'low-confidence' && prefilled.ingredient && prefilled.alternatives) {
        return {
          type: 'low-confidence',
          extractedName: prefilled.extractedName ?? prefilled.ingredient.name,
          originalText: prefilled.originalText,
          ingredient: prefilled.ingredient,
          alternatives: prefilled.alternatives,
          totalQuantity: prefilled.convertedQuantity ?? 100,
          isVague: prefilled.isVague,
          originalPhrase: prefilled.originalPhrase,
        }
      }

      // Default: matched (high-confidence)
      if (prefilled.ingredient) {
        return {
          type: 'matched',
          ingredient: prefilled.ingredient,
          totalQuantity: prefilled.convertedQuantity ?? 100,
          isVague: prefilled.isVague,
          originalPhrase: prefilled.originalPhrase,
        }
      }

      // Fallback for invalid data
      return {
        type: 'unmatched',
        extractedName: prefilled.extractedName ?? 'Unknown',
        originalText: prefilled.originalText ?? '',
        extractedQuantity: 0,
        extractedUnit: '',
      }
    })

    // Sort: unmatched first, then low-confidence, then matched
    const typeOrder = { unmatched: 0, 'low-confidence': 1, matched: 2 }
    return rows.sort((a, b) => typeOrder[a.type] - typeOrder[b.type])
  })

  // Ingredient search state (for adding new ingredients)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<IngredientResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const ingredientRowsRef = useRef<HTMLDivElement>(null)

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Determine if we're in import mode (with ingredient rows) or regular mode (with components)
  const isImportMode = hasPrefilledIngredients || ingredientRows.length > 0

  // Calculate unresolved count
  const unresolvedCount = ingredientRows.filter((row) => row.type === 'unmatched').length
  const lowConfidenceCount = ingredientRows.filter((row) => row.type === 'low-confidence').length

  // Detect duplicate ingredients by ID
  const duplicateMap = useMemo(() => {
    const map = new Map<string, number[]>()

    if (isImportMode) {
      // Check ingredient rows (import mode)
      ingredientRows.forEach((row, index) => {
        if (row.type === 'matched' || row.type === 'low-confidence') {
          const id = row.ingredient.id
          const indices = map.get(id) ?? []
          indices.push(index)
          map.set(id, indices)
        }
      })
    } else {
      // Check components (regular mode)
      components.forEach((comp, index) => {
        const id = comp.ingredientId
        const indices = map.get(id) ?? []
        indices.push(index)
        map.set(id, indices)
      })
    }

    // Keep only duplicates (2+ occurrences)
    const duplicates = new Map<string, number[]>()
    map.forEach((indices, id) => {
      if (indices.length > 1) {
        duplicates.set(id, indices)
      }
    })

    return duplicates
  }, [isImportMode, ingredientRows, components])

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

  // Get all ingredient IDs currently in use
  const getAllIngredientIds = useCallback((): string[] => {
    const fromComponents = components.map((c) => c.ingredientId)
    const fromRows = ingredientRows
      .filter(
        (r): r is Extract<IngredientRowData, { type: 'matched' | 'low-confidence' }> =>
          r.type === 'matched' || r.type === 'low-confidence',
      )
      .map((r) => r.ingredient.id)
    return [...fromComponents, ...fromRows]
  }, [components, ingredientRows])

  const addIngredient = useCallback(
    (ingredient: IngredientResult) => {
      const existingIds = getAllIngredientIds()
      if (existingIds.includes(ingredient.id)) {
        toast.error(`${ingredient.name} is already added`)
        return
      }

      if (isImportMode) {
        // Add as a matched ingredient row
        setIngredientRows([
          ...ingredientRows,
          {
            type: 'matched',
            ingredient,
            totalQuantity: ingredient.defaultUnit === 'piece' ? 1 : 100,
          },
        ])
      } else {
        // Add as component
        setComponents([
          ...components,
          {
            ingredientId: ingredient.id,
            ingredient,
            totalQuantity: ingredient.defaultUnit === 'piece' ? 1 : 100,
          },
        ])
      }
      setSearchQuery('')
      setShowDropdown(false)
      setSearchResults([])
    },
    [getAllIngredientIds, isImportMode, ingredientRows, components],
  )

  const removeComponent = (ingredientId: string) => {
    setComponents(components.filter((c) => c.ingredientId !== ingredientId))
  }

  const updateComponentQuantity = (ingredientId: string, quantity: number) => {
    setComponents(
      components.map((c) =>
        c.ingredientId === ingredientId
          ? {
              ...c,
              totalQuantity: quantity,
              isVague: false,
              originalPhrase: null,
            }
          : c,
      ),
    )
  }

  const setComponentQuantity = (ingredientId: string, defaultUnit: Unit) => {
    // Set a reasonable default quantity based on unit type
    const defaultQuantity = defaultUnit === 'piece' ? 1 : 5
    setComponents(
      components.map((c) =>
        c.ingredientId === ingredientId
          ? {
              ...c,
              totalQuantity: defaultQuantity,
              isVague: false,
              originalPhrase: null,
            }
          : c,
      ),
    )
  }

  const handleIngredientRowUpdate = (index: number, updatedData: IngredientRowData) => {
    setIngredientRows(ingredientRows.map((row, i) => (i === index ? updatedData : row)))
  }

  const handleIngredientRowRemove = (index: number) => {
    setIngredientRows(ingredientRows.filter((_, i) => i !== index))
  }

  const handleIngredientRowResolve = (
    index: number,
    ingredient: IngredientResult,
    totalQuantity: number,
  ) => {
    // Convert unmatched to matched
    setIngredientRows(
      ingredientRows.map((row, i) =>
        i === index
          ? {
              type: 'matched' as const,
              ingredient,
              totalQuantity,
            }
          : row,
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

    // Build final components list
    let finalComponents: {
      ingredientId: string
      totalQuantity: number
      isVague: boolean
      originalPhrase: string | null
    }[]

    if (isImportMode) {
      // Check for unresolved ingredients
      const unresolved = ingredientRows.filter(
        (r): r is Extract<IngredientRowData, { type: 'unmatched' }> => r.type === 'unmatched',
      )
      if (unresolved.length > 0) {
        const names = unresolved.map((r) => r.extractedName)
        setError(`Resolve unmatched ingredients: ${formatIngredientList(names)}`)
        // Scroll to the ingredient rows section
        ingredientRowsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }

      // Check for unconfirmed low-confidence matches
      const lowConfidence = ingredientRows.filter(
        (r): r is Extract<IngredientRowData, { type: 'low-confidence' }> =>
          r.type === 'low-confidence',
      )
      if (lowConfidence.length > 0) {
        const names = lowConfidence.map((r) => r.extractedName)
        setError(`Verify matches before saving: ${formatIngredientList(names)}`)
        // Scroll to the ingredient rows section
        ingredientRowsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }

      // Only matched ingredients at this point
      finalComponents = ingredientRows
        .filter((r): r is Extract<IngredientRowData, { type: 'matched' }> => r.type === 'matched')
        .map((r) => ({
          ingredientId: r.ingredient.id,
          totalQuantity: r.totalQuantity,
          isVague: r.isVague ?? false,
          originalPhrase: r.originalPhrase ?? null,
        }))
    } else {
      finalComponents = components.map((c) => ({
        ingredientId: c.ingredientId,
        totalQuantity: c.totalQuantity,
        isVague: c.isVague ?? false,
        originalPhrase: c.originalPhrase ?? null,
      }))
    }

    if (finalComponents.length === 0) {
      setError('Add at least one ingredient')
      return
    }

    // Validate all quantities are positive
    if (isImportMode) {
      const invalidRows = ingredientRows.filter(
        (r): r is Extract<IngredientRowData, { type: 'matched' }> =>
          r.type === 'matched' && !r.isVague && r.totalQuantity <= 0,
      )
      if (invalidRows.length > 0) {
        const names = invalidRows.map((r) => r.ingredient.name)
        setError(`Quantity must be greater than 0: ${formatIngredientList(names)}`)
        return
      }
    } else {
      const invalidComps = components.filter((c) => !c.isVague && c.totalQuantity <= 0)
      if (invalidComps.length > 0) {
        const names = invalidComps.map((c) => c.ingredient.name)
        setError(`Quantity must be greater than 0: ${formatIngredientList(names)}`)
        return
      }
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
        components: finalComponents,
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

  // Calculate servings for display
  const servingsNum = parseInt(servings, 10) || 1

  const totalIngredientCount = isImportMode ? ingredientRows.length : components.length
  const hasIngredients = totalIngredientCount > 0

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
            {/* Original Recipe Text Section (import mode only) */}
            {originalRecipeText && (
              <Collapsible open={isOriginalTextOpen} onOpenChange={setIsOriginalTextOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="bg-muted/50 hover:bg-muted flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors"
                  >
                    {isOriginalTextOpen ? (
                      <ChevronDown className="text-muted-foreground h-4 w-4" />
                    ) : (
                      <ChevronRight className="text-muted-foreground h-4 w-4" />
                    )}
                    <Body variant="small" className="font-medium">
                      Original recipe text
                    </Body>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="bg-muted/30 mt-2 max-h-64 overflow-y-auto rounded-md border p-3">
                    <Body variant="small" className="whitespace-pre-wrap">
                      {originalRecipeText}
                    </Body>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

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
            </section>

            {/* Ingredients Section */}
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <Heading variant="h4">Ingredients</Heading>
                {isImportMode && (unresolvedCount > 0 || lowConfidenceCount > 0) && (
                  <div className="flex gap-2">
                    {lowConfidenceCount > 0 && (
                      <Badge variant="outline" className="text-blue-600">
                        {lowConfidenceCount} to verify
                      </Badge>
                    )}
                    {unresolvedCount > 0 && (
                      <Badge variant="outline" className="text-amber-600">
                        {unresolvedCount} unmatched
                      </Badge>
                    )}
                  </div>
                )}
              </div>
              <Body variant="muted">
                Enter the total quantity needed for the entire recipe ({servingsNum} servings). We
                will calculate per-serving amounts automatically.
              </Body>

              {/* Import mode: show ingredient rows with match states */}
              {isImportMode && ingredientRows.length > 0 && (
                <div ref={ingredientRowsRef} className="flex flex-col gap-2">
                  {ingredientRows.map((row, index) => {
                    // Get duplicate indices for this row (if it's matched or low-confidence)
                    const duplicateIndices =
                      row.type === 'matched' || row.type === 'low-confidence'
                        ? duplicateMap.get(row.ingredient.id)?.filter((i) => i !== index)
                        : undefined

                    return (
                      <IngredientRow
                        key={index}
                        data={row}
                        servings={servingsNum}
                        disabled={isSubmitting}
                        duplicateIndices={duplicateIndices}
                        onUpdate={(updatedData) => handleIngredientRowUpdate(index, updatedData)}
                        onRemove={() => handleIngredientRowRemove(index)}
                        onResolve={(ingredient, totalQuantity) =>
                          handleIngredientRowResolve(index, ingredient, totalQuantity)
                        }
                      />
                    )
                  })}
                </div>
              )}

              {/* Regular mode: show plain ingredient list */}
              {!isImportMode && components.length > 0 && (
                <div className="flex flex-col gap-2">
                  {components.map((comp, index) => {
                    const isInvalidQuantity = !comp.isVague && comp.totalQuantity <= 0
                    const unitLabel = formatUnit(comp.ingredient.defaultUnit)
                    const duplicateIndices = duplicateMap.get(comp.ingredientId)
                    const isDuplicate = duplicateIndices && duplicateIndices.length > 1
                    const otherIndices = isDuplicate
                      ? duplicateIndices.filter((i) => i !== index)
                      : []
                    return (
                      <div key={index} className="flex items-center gap-3 rounded-md border p-3">
                        <div className="flex-1">
                          <Body>{comp.ingredient.name}</Body>
                          <Body variant="muted">
                            {comp.isVague && comp.originalPhrase ? (
                              <span className="italic">{comp.originalPhrase}</span>
                            ) : isInvalidQuantity ? (
                              <span className="text-destructive">
                                Quantity must be greater than 0
                              </span>
                            ) : (
                              <>
                                {Math.round((comp.totalQuantity / servingsNum) * 10) / 10}
                                {unitLabel} per serving
                              </>
                            )}
                          </Body>
                          {isDuplicate && (
                            <div className="mt-1 flex items-center gap-1.5">
                              <Info className="h-3 w-3 shrink-0 text-amber-600" />
                              <Body variant="small" className="text-amber-700 dark:text-amber-400">
                                Also used in row{otherIndices.length > 1 ? 's' : ''}{' '}
                                {otherIndices.map((i) => i + 1).join(', ')}
                              </Body>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {comp.isVague ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setComponentQuantity(comp.ingredientId, comp.ingredient.defaultUnit)
                              }
                              disabled={isSubmitting}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              Set quantity
                            </Button>
                          ) : (
                            <div
                              className={cn(
                                'flex items-center rounded-md border',
                                isInvalidQuantity ? 'border-destructive' : 'border-input',
                              )}
                            >
                              <Input
                                type="number"
                                value={comp.totalQuantity}
                                onChange={(e) =>
                                  updateComponentQuantity(
                                    comp.ingredientId,
                                    parseFloat(e.target.value) || 0,
                                  )
                                }
                                min={0.1}
                                step="any"
                                className="w-20 border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                                disabled={isSubmitting}
                              />
                              {unitLabel && (
                                <span className="text-muted-foreground bg-muted border-l px-2 py-1.5 text-sm">
                                  {unitLabel}
                                </span>
                              )}
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeComponent(comp.ingredientId)}
                            disabled={isSubmitting}
                          >
                            ×
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Ingredient search (always available to add more) */}
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
                    placeholder="Search to add more ingredients..."
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
                      const existingIds = getAllIngredientIds()
                      const isAdded = existingIds.includes(ingredient.id)
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

              {!hasIngredients && (
                <div className="border-muted rounded-md border border-dashed p-6 text-center">
                  <Body variant="muted">No ingredients added yet. Search above to add some.</Body>
                </div>
              )}
            </section>

            {/* Additional Details Section */}
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
                        onCheckedChange={(checked) =>
                          handleMealTypeToggle(mealType.value, checked === true)
                        }
                        disabled={isSubmitting}
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
                  onChange={(e) => setTimeMinutes(e.target.value)}
                  min={1}
                  max={480}
                  disabled={isSubmitting}
                  placeholder="e.g., 30"
                />
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
