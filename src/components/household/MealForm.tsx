'use client'

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { IngredientRow, type IngredientRowData } from '@/components/recipes/IngredientRow'
import { NutritionDisclaimer } from '@/components/NutritionDisclaimer'
import { NutritionSummary } from '@/components/meal-plan/NutritionSummary'
import {
  type MealTypeValue,
  type IngredientResult,
  type MealComponent,
  type MealFormProps,
  buildFinalComponents,
} from './meal-form-types'
import { MealFormBasicInfo } from './MealFormBasicInfo'
import { MealFormDetails } from './MealFormDetails'
import { ComponentList } from './ComponentList'
import { IngredientSearch } from './IngredientSearch'
import { prefersReducedMotion } from '@/lib/utils'
import { parseLocalizedNumber } from '@/lib/i18n/parse-number'
import type { Unit } from '@/generated/prisma/enums'

export type { MealFormData, PrefilledIngredient } from './meal-form-types'

export function MealForm({ meal, defaultServings, onSuccess, onCancel }: MealFormProps) {
  const t = useTranslations('recipes.form')
  const isEditing = !!meal?.id
  const hasPrefilledIngredients = !!meal?.prefilledIngredients?.length
  const originalRecipeText = meal?.originalRecipeText

  // Collapsible state for original recipe text
  const [isOriginalTextOpen, setIsOriginalTextOpen] = useState(false)

  // Form state
  const [name, setName] = useState(meal?.name ?? '')
  const [description, setDescription] = useState(meal?.description ?? '')
  const [preparationNotes, setPreparationNotes] = useState(meal?.preparationNotes ?? '')
  const [timeMinutes, setTimeMinutes] = useState<string>(
    meal?.timeMinutes ? String(meal.timeMinutes) : '',
  )
  const [sourceUrl, setSourceUrl] = useState(meal?.sourceUrl ?? '')
  const [kidFriendly, setKidFriendly] = useState(meal?.kidFriendly ?? false)
  const [suitableFor, setSuitableFor] = useState<MealTypeValue[]>(
    (meal?.suitableFor as MealTypeValue[]) ?? ['dinner'],
  )
  const editServings = meal?.servings ?? defaultServings ?? 4
  const [servings, setServings] = useState<string>(String(editServings))

  // Standard components (for plain ingredient rows when editing)
  const [components, setComponents] = useState<MealComponent[]>(() => {
    if (!meal?.components) return []
    return meal.components.map((c) => ({
      ingredientId: c.ingredientId,
      ingredient: c.ingredient,
      totalQuantity: c.quantityPerServing * editServings,
      isVague: c.isVague,
      originalPhrase: c.originalPhrase,
    }))
  })

  // Enhanced ingredient rows (for import flow with match states)
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

      if (prefilled.ingredient) {
        return {
          type: 'matched',
          ingredient: prefilled.ingredient,
          totalQuantity: prefilled.convertedQuantity ?? 100,
          isVague: prefilled.isVague,
          originalPhrase: prefilled.originalPhrase,
        }
      }

      return {
        type: 'unmatched',
        extractedName: prefilled.extractedName ?? 'Unknown',
        originalText: prefilled.originalText ?? '',
        extractedQuantity: 0,
        extractedUnit: '',
      }
    })

    const typeOrder = { unmatched: 0, 'low-confidence': 1, matched: 2 }
    return rows.sort((a, b) => typeOrder[a.type] - typeOrder[b.type])
  })

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false)
  const ingredientRowsRef = useRef<HTMLDivElement>(null)

  const isImportMode = hasPrefilledIngredients || ingredientRows.length > 0
  const unresolvedCount = ingredientRows.filter((row) => row.type === 'unmatched').length
  const lowConfidenceCount = ingredientRows.filter((row) => row.type === 'low-confidence').length

  // Add beforeunload listener to warn about losing imported data
  useEffect(() => {
    if (!hasPrefilledIngredients) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasPrefilledIngredients])

  // Detect duplicate ingredients by ID
  const duplicateMap = useMemo(() => {
    const map = new Map<string, number[]>()

    if (isImportMode) {
      ingredientRows.forEach((row, index) => {
        if (row.type === 'matched' || row.type === 'low-confidence') {
          const id = row.ingredient.id
          const indices = map.get(id) ?? []
          indices.push(index)
          map.set(id, indices)
        }
      })
    } else {
      components.forEach((comp, index) => {
        const id = comp.ingredientId
        const indices = map.get(id) ?? []
        indices.push(index)
        map.set(id, indices)
      })
    }

    const duplicates = new Map<string, number[]>()
    map.forEach((indices, id) => {
      if (indices.length > 1) {
        duplicates.set(id, indices)
      }
    })

    return duplicates
  }, [isImportMode, ingredientRows, components])

  // Compute live nutrition summary from current ingredients
  const nutritionSummary = useMemo(() => {
    const servingsNum = parseLocalizedNumber(servings, { integer: true }) ?? 1
    const nutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 }
    let matchedCount = 0
    let unmatchedCount = 0
    let hasVague = false

    const addNutrition = (
      ing: {
        calories?: number
        protein?: number
        carbs?: number
        fat?: number
        defaultUnit: string
        gramsPerPiece?: number | null
      },
      totalQuantity: number,
    ) => {
      const quantityPerServing = totalQuantity / servingsNum
      // For piece-unit ingredients, convert pieces to grams first
      const gramsPerServing =
        ing.defaultUnit === 'piece' && ing.gramsPerPiece
          ? quantityPerServing * ing.gramsPerPiece
          : quantityPerServing
      const factor = gramsPerServing / 100
      nutrition.calories += (ing.calories ?? 0) * factor
      nutrition.protein += (ing.protein ?? 0) * factor
      nutrition.carbs += (ing.carbs ?? 0) * factor
      nutrition.fat += (ing.fat ?? 0) * factor
    }

    if (isImportMode) {
      for (const row of ingredientRows) {
        if (row.type === 'unmatched') {
          unmatchedCount++
          continue
        }
        if (row.ingredient.calories == null) continue
        if (row.isVague) {
          hasVague = true
          continue
        }
        matchedCount++
        addNutrition(row.ingredient, row.totalQuantity)
      }
    } else {
      for (const comp of components) {
        if (comp.ingredient.calories == null) continue
        if (comp.isVague) {
          hasVague = true
          continue
        }
        matchedCount++
        addNutrition(comp.ingredient, comp.totalQuantity)
      }
    }

    return { nutrition, matchedCount, unmatchedCount, hasVague }
  }, [isImportMode, ingredientRows, components, servings])

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
        toast.error(t('alreadyAdded', { name: ingredient.name }))
        return
      }

      if (isImportMode) {
        setIngredientRows([
          ...ingredientRows,
          {
            type: 'matched',
            ingredient,
            totalQuantity: ingredient.defaultUnit === 'piece' ? 1 : 100,
          },
        ])
      } else {
        setComponents([
          ...components,
          {
            ingredientId: ingredient.id,
            ingredient,
            totalQuantity: ingredient.defaultUnit === 'piece' ? 1 : 100,
          },
        ])
      }
    },
    [getAllIngredientIds, isImportMode, ingredientRows, components, t],
  )

  const removeComponent = (ingredientId: string) => {
    setComponents(components.filter((c) => c.ingredientId !== ingredientId))
  }

  const updateComponentQuantity = (ingredientId: string, quantity: number) => {
    setComponents(
      components.map((c) =>
        c.ingredientId === ingredientId
          ? { ...c, totalQuantity: quantity, isVague: false, originalPhrase: null }
          : c,
      ),
    )
  }

  const setComponentQuantity = (ingredientId: string, defaultUnit: Unit) => {
    const defaultQuantity = defaultUnit === 'piece' ? 1 : 5
    setComponents(
      components.map((c) =>
        c.ingredientId === ingredientId
          ? { ...c, totalQuantity: defaultQuantity, isVague: false, originalPhrase: null }
          : c,
      ),
    )
  }

  const markComponentAsVague = (ingredientId: string) => {
    setComponents(
      components.map((c) =>
        c.ingredientId === ingredientId ? { ...c, isVague: true, originalPhrase: 'to taste' } : c,
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
    setIngredientRows(
      ingredientRows.map((row, i) =>
        i === index ? { type: 'matched' as const, ingredient, totalQuantity } : row,
      ),
    )
  }

  const handleCancelClick = () => {
    if (hasPrefilledIngredients) {
      setShowDiscardConfirmation(true)
    } else {
      onCancel()
    }
  }

  const handleConfirmDiscard = () => {
    setShowDiscardConfirmation(false)
    onCancel()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError(t('errors.nameRequired'))
      return
    }

    if (suitableFor.length === 0) {
      setError(t('errors.mealTypeRequired'))
      return
    }

    const servingsNum = parseLocalizedNumber(servings, { integer: true })
    if (servingsNum === null || servingsNum < 1 || servingsNum > 50) {
      setError(t('errors.servingsRange'))
      return
    }

    const result = buildFinalComponents(isImportMode, ingredientRows, components)
    if (result.error) {
      setError(result.error)
      if (isImportMode) {
        ingredientRowsRef.current?.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'start',
        })
      }
      return
    }

    setIsSubmitting(true)

    try {
      const timeMinutesNum = timeMinutes
        ? parseLocalizedNumber(timeMinutes, { integer: true })
        : null
      if (timeMinutes && (timeMinutesNum === null || timeMinutesNum < 1 || timeMinutesNum > 480)) {
        setError(t('errors.prepTimeRange'))
        setIsSubmitting(false)
        return
      }

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        preparationNotes: preparationNotes.trim() || null,
        sourceUrl: sourceUrl.trim() || null,
        timeMinutes: timeMinutesNum,
        kidFriendly,
        suitableFor,
        servings: servingsNum,
        components: result.components,
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
        throw new Error(
          data.error || (isEditing ? t('errors.updateFailed') : t('errors.createFailed')),
        )
      }

      toast.success(isEditing ? t('successUpdated') : t('successCreated'))
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const servingsNum = parseLocalizedNumber(servings, { integer: true }) ?? 1
  const totalIngredientCount = isImportMode ? ingredientRows.length : components.length
  const hasIngredients = totalIngredientCount > 0

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <Heading variant="h4">{isEditing ? t('titleEdit') : t('titleCreate')}</Heading>
        <Body variant="muted">{isEditing ? t('descriptionEdit') : t('descriptionCreate')}</Body>
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
                      {t('originalTextLabel')}
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

            <MealFormBasicInfo
              name={name}
              onNameChange={setName}
              description={description}
              onDescriptionChange={setDescription}
              servings={servings}
              onServingsChange={setServings}
              disabled={isSubmitting}
            />

            {/* Ingredients Section */}
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <Heading variant="h4">{t('ingredientsHeading')}</Heading>
                {isImportMode && (unresolvedCount > 0 || lowConfidenceCount > 0) && (
                  <div className="flex gap-2">
                    {lowConfidenceCount > 0 && (
                      <Badge variant="outline" className="text-blue-700 dark:text-blue-400">
                        {t('toVerifyBadge', { count: lowConfidenceCount })}
                      </Badge>
                    )}
                    {unresolvedCount > 0 && (
                      <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                        {t('unmatchedBadge', { count: unresolvedCount })}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
              <Body variant="muted">{t('ingredientsHelper', { count: servingsNum })}</Body>

              {/* Import mode: show ingredient rows with match states */}
              {isImportMode && ingredientRows.length > 0 && (
                <div ref={ingredientRowsRef} className="flex flex-col gap-2">
                  {ingredientRows.map((row, index) => {
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
              {!isImportMode && (
                <ComponentList
                  components={components}
                  servings={servingsNum}
                  disabled={isSubmitting}
                  duplicateMap={duplicateMap}
                  onRemove={removeComponent}
                  onUpdateQuantity={updateComponentQuantity}
                  onSetQuantity={setComponentQuantity}
                  onMarkAsVague={markComponentAsVague}
                />
              )}

              <IngredientSearch
                disabled={isSubmitting}
                existingIngredientIds={getAllIngredientIds()}
                onAddIngredient={addIngredient}
              />

              {!hasIngredients && (
                <div className="border-muted rounded-md border border-dashed p-6 text-center">
                  <Body variant="muted">{t('noIngredients')}</Body>
                </div>
              )}

              {/* Live nutrition summary */}
              {nutritionSummary.matchedCount > 0 && (
                <div className="bg-muted/50 rounded-md border px-3 py-2">
                  <div className="mb-1">
                    <Body variant="caption">{t('nutritionPerServing')}</Body>
                  </div>
                  <NutritionSummary
                    nutrition={nutritionSummary.nutrition}
                    compact
                    components={nutritionSummary.hasVague ? [{ isVague: true }] : undefined}
                  />
                  {nutritionSummary.unmatchedCount > 0 && (
                    <div className="mt-1">
                      <Body variant="caption">
                        {t('nutritionApproximate', { count: nutritionSummary.unmatchedCount })}
                      </Body>
                    </div>
                  )}
                  <div className="mt-2">
                    <NutritionDisclaimer className="text-xs" />
                  </div>
                </div>
              )}
            </section>

            <MealFormDetails
              suitableFor={suitableFor}
              onMealTypeToggle={handleMealTypeToggle}
              timeMinutes={timeMinutes}
              onTimeMinutesChange={setTimeMinutes}
              kidFriendly={kidFriendly}
              onKidFriendlyChange={setKidFriendly}
              disabled={isSubmitting}
            />

            {/* Preparation Notes Section */}
            <section className="flex flex-col gap-2">
              <Label htmlFor="preparationNotes">{t('preparationNotesLabel')}</Label>
              <Body variant="muted">{t('preparationNotesHelper')}</Body>
              <Textarea
                id="preparationNotes"
                value={preparationNotes}
                onChange={(e) => setPreparationNotes(e.target.value)}
                placeholder={t('preparationNotesPlaceholder')}
                rows={5}
                maxLength={5000}
                disabled={isSubmitting}
                className="resize-y"
              />
            </section>

            {/* Source URL Section */}
            <section className="flex flex-col gap-2">
              <Label htmlFor="sourceUrl">{t('sourceUrlLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="sourceUrl"
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder={t('sourceUrlPlaceholder')}
                  disabled={isSubmitting}
                />
                {sourceUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setSourceUrl('')}
                    disabled={isSubmitting}
                    aria-label={t('sourceUrlClearAria')}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
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
                onClick={handleCancelClick}
                disabled={isSubmitting}
                className="flex-1"
              >
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting} className="flex-1">
                {isSubmitting ? t('saving') : isEditing ? t('update') : t('create')}
              </Button>
            </div>
          </div>
        </CardFooter>
      </form>

      {/* Discard confirmation dialog */}
      <AlertDialog open={showDiscardConfirmation} onOpenChange={setShowDiscardConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('discardDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('discardDialog.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('discardDialog.keepEditing')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDiscard}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('discardDialog.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
