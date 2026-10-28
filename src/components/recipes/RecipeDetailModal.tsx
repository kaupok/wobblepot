'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { MoreHorizontal, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CookViewDialog } from '@/components/meal-plan/CookViewDialog'
import { MealDetail } from '@/components/meal-plan/MealDetail'
import type { MealData } from '@/components/meal-plan/types'
import { useMealImage } from '@/hooks/use-meal-image'
import { useRecipeSteps } from '@/hooks/use-recipe-steps'
import { useCookQuestionPanel } from '@/hooks/use-cook-question-panel'

interface RecipeDetailModalProps {
  meal: MealData
  /** The household's portions summed (HON-1040): the count the view opens at. */
  householdServings: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** "How to prepare" never shows: the steps load as the view opens. */
function noop() {}

/**
 * The cook view for a recipe outside the plan, opened from My recipes
 * (HON-1338): one of the household's own recipes or a library meal, which the
 * steps and Ask routes both accept (HON-1351). The planned view's shell and
 * body, without what belongs to a plan entry: no note, no "Done cooking", no
 * pantry ticks, no conflict badges and no ingredient changes. The serving
 * count can change, but only on screen: closing the view drops it, and nothing
 * is saved. The steps are written for the count on screen, and Ask asks about
 * them at that count (HON-1339).
 */
export function RecipeDetailModal({
  meal,
  householdServings,
  open,
  onOpenChange,
}: RecipeDetailModalProps) {
  const tDetail = useTranslations('meal-plan.detail')
  const tList = useTranslations('recipes.list')
  const [servings, setServings] = useState(householdServings)
  const image = useMealImage({ meal, open })
  const { steps, isLoadingSteps, stepsError, retry } = useRecipeSteps({
    meal,
    servings,
    enabled: open,
  })

  const {
    controls: questionControls,
    closeForTickedStep,
    forgetOpenSubject,
  } = useCookQuestionPanel({ mealId: meal.id, servings })

  // Ticked steps, tied to the steps object they were ticked against: new
  // steps (another count, another recipe) start unticked.
  const [doneSteps, setDoneSteps] = useState<ReadonlySet<number>>(() => new Set())
  const [doneStepsFor, setDoneStepsFor] = useState(steps)
  if (doneStepsFor !== steps) {
    setDoneStepsFor(steps)
    setDoneSteps(new Set())
    // An open question panel points at a step or an item of the old lists.
    forgetOpenSubject()
  }
  // A closed view starts afresh: the household's servings, nothing ticked.
  if (!open && (servings !== householdServings || doneSteps.size > 0)) {
    setServings(householdServings)
    setDoneSteps(new Set())
  }

  const handleToggleStep = useCallback(
    (index: number) => {
      if (!doneSteps.has(index)) closeForTickedStep(index)
      setDoneSteps((prev) => {
        const next = new Set(prev)
        if (!next.delete(index)) next.add(index)
        return next
      })
    },
    [doneSteps, closeForTickedStep],
  )

  // Closing the view drops the question, and stops one in flight.
  const { onClose: closeQuestion } = questionControls
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) closeQuestion()
      onOpenChange(next)
    },
    [closeQuestion, onOpenChange],
  )

  // `ServingControl` sends null for the household's own count.
  const handleServingsChange = useCallback(
    async (next: number | null) => {
      setServings(next ?? householdServings)
      return true
    },
    [householdServings],
  )

  return (
    <CookViewDialog
      meal={meal}
      open={open}
      onOpenChange={handleOpenChange}
      image={{ status: image.status, imageUrl: image.imageUrl, imageHue: image.imageHue }}
    >
      {(parts) => (
        <MealDetail
          meal={meal}
          image={parts.image}
          title={parts.title}
          // As in the planned view: a 44px trigger on the title row. A real
          // link, so middle-click and open-in-new-tab work. A library meal is
          // not the household's to edit, and Edit is the menu's only item, so
          // it has no menu (HON-1352).
          titleActions={
            meal.isCustom ? (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    aria-label={tDetail('moreActions', { name: meal.name })}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href={`/recipes/${meal.id}/edit`}>
                      <Pencil aria-hidden="true" />
                      {tList('edit')}
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : undefined
          }
          householdServings={householdServings}
          servings={servings}
          onServingsChange={handleServingsChange}
          steps={steps}
          isLoadingSteps={isLoadingSteps}
          stepsError={stepsError}
          onRetrySteps={retry}
          isStepsExpanded
          onHowToPrepare={noop}
          doneSteps={doneSteps}
          onToggleStep={handleToggleStep}
          cookQuestion={questionControls}
        />
      )}
    </CookViewDialog>
  )
}
