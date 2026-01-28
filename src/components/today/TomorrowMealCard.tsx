'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { MealSelectorModal } from '@/components/meal-plan/MealSelectorModal'
import { MealDetail } from '@/components/meal-plan/MealDetail'
import { NoteEditor } from '@/components/meal-plan/NoteEditor'
import { useIngredientAvailability } from '@/hooks/use-ingredient-availability'
import { useMealTips } from '@/hooks/use-meal-tips'
import type { MealData, PantryIngredient } from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'

const mealTypeLabels: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

interface TomorrowMealCardProps {
  entryId: string
  planId: string
  meal: MealData | null
  mealType: MealType
  householdSize: number
  pantryIngredients: PantryIngredient[]
  initialNote?: string | null
}

export function TomorrowMealCard({
  entryId,
  planId,
  meal,
  mealType,
  householdSize,
  pantryIngredients,
  initialNote = null,
}: TomorrowMealCardProps) {
  const router = useRouter()
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [note, setNote] = useState<string | null>(initialNote)
  const { togglingIngredientIds, handleToggleAvailability } = useIngredientAvailability({
    onRefresh: () => router.refresh(),
  })
  const {
    tips,
    isLoadingTips,
    tipsError,
    isTipsExpanded,
    fetchTips,
    handleHowToPrepare,
    hideTips,
  } = useMealTips({ planId, entryId })

  // Empty state - no meal planned
  if (!meal) {
    return (
      <>
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                {mealTypeLabels[mealType]}
              </div>
              <Button variant="outline" size="sm" onClick={() => setIsSelectorOpen(true)}>
                Add meal
              </Button>
            </div>
            {note ? (
              <Body variant="muted" className="italic">
                {note}
              </Body>
            ) : (
              <Body variant="muted">No meal planned</Body>
            )}
            <NoteEditor planId={planId} entryId={entryId} note={note} onNoteChange={setNote} />
          </CardHeader>
        </Card>
        <MealSelectorModal
          open={isSelectorOpen}
          onOpenChange={setIsSelectorOpen}
          planId={planId}
          entryId={entryId}
          mealType={mealType}
          householdSize={householdSize}
          onSwapComplete={() => router.refresh()}
          mode="add"
        />
      </>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-0">
          {/* Top row: Meal type label + Swap button */}
          <div className="flex items-center justify-between">
            <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
              {mealTypeLabels[mealType]}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSelectorOpen(true)}
              className="shrink-0"
            >
              Swap
            </Button>
          </div>

          {/* Meal name */}
          <CardTitle className="text-base leading-tight font-semibold">{meal.name}</CardTitle>
          {/* Note section */}
          <NoteEditor planId={planId} entryId={entryId} note={note} onNoteChange={setNote} />
        </CardHeader>

        {/* Full meal detail - always shown */}
        <div className="px-6 pt-4 pb-6">
          <MealDetail
            meal={meal}
            householdSize={householdSize}
            pantryIngredients={pantryIngredients}
            onToggleAvailability={handleToggleAvailability}
            togglingIds={togglingIngredientIds}
            tips={tips}
            isLoadingTips={isLoadingTips}
            tipsError={tipsError}
            onRetryTips={fetchTips}
            isTipsExpanded={isTipsExpanded}
            onHowToPrepare={handleHowToPrepare}
            onHideTips={hideTips}
          />
        </div>
      </Card>
      <MealSelectorModal
        open={isSelectorOpen}
        onOpenChange={setIsSelectorOpen}
        planId={planId}
        entryId={entryId}
        mealType={mealType}
        householdSize={householdSize}
        currentMealName={meal.name}
        onSwapComplete={() => router.refresh()}
        mode="swap"
      />
    </>
  )
}
