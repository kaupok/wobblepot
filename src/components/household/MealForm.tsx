'use client'

import { useState } from 'react'
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
import { IngredientRow } from '@/components/recipes/IngredientRow'
import { NutritionDisclaimer } from '@/components/NutritionDisclaimer'
import { NutritionSummary } from '@/components/meal-plan/NutritionSummary'
import { type MealFormProps } from './meal-form-types'
import { MealFormBasicInfo } from './MealFormBasicInfo'
import { MealFormDetails } from './MealFormDetails'
import { ComponentList } from './ComponentList'
import { IngredientSearch } from './IngredientSearch'
import { useMealForm } from './use-meal-form'

export type { MealFormData, PrefilledIngredient } from './meal-form-types'

export function MealForm({ meal, defaultServings, onSuccess, onCancel }: MealFormProps) {
  const t = useTranslations('recipes.form')
  // Destructured rather than kept as one object: `ingredientRowsRef` is a ref,
  // and reading any field off a ref-carrying object during render trips the
  // React Compiler's "Cannot access refs during render" rule.
  const {
    isEditing,
    isImportMode,
    hasPrefilledIngredients,
    originalRecipeText,
    name,
    setName,
    description,
    setDescription,
    preparationNotes,
    setPreparationNotes,
    timeMinutes,
    setTimeMinutes,
    sourceUrl,
    setSourceUrl,
    kidFriendly,
    setKidFriendly,
    suitableFor,
    handleMealTypeToggle,
    servings,
    setServings,
    components,
    ingredientRows,
    ingredientRowsRef,
    duplicateMap,
    unresolvedCount,
    lowConfidenceCount,
    hasIngredients,
    servingsNum,
    nutritionSummary,
    getAllIngredientIds,
    addIngredient,
    removeComponent,
    updateComponentQuantity,
    setComponentQuantity,
    markComponentAsVague,
    handleIngredientRowUpdate,
    handleIngredientRowRemove,
    handleIngredientRowResolve,
    isSubmitting,
    error,
    handleSubmit,
  } = useMealForm({ meal, defaultServings, onSuccess })

  // Collapsible state for original recipe text
  const [isOriginalTextOpen, setIsOriginalTextOpen] = useState(false)
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false)

  const handleCancelClick = () => {
    // Imported data is unrecoverable once discarded, so confirm first.
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
                      <Badge variant="outline" className="text-info">
                        {t('toVerifyBadge', { count: lowConfidenceCount })}
                      </Badge>
                    )}
                    {unresolvedCount > 0 && (
                      <Badge variant="outline" className="text-warning">
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
                        {t('nutritionApproximate', {
                          count: nutritionSummary.unmatchedCount,
                        })}
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
