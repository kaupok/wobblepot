'use client'

import { useCallback, useState } from 'react'
import { useCookQuestion, type UseCookQuestionOptions } from '@/hooks/use-cook-question'
import { sameSubject, type CookQuestionSubject } from '@/lib/ai/cook-question-subject'
import type { CookQuestionControls } from '@/components/meal-plan/PreparationSteps'

/**
 * Ask in the cook view: which panel is open and the question in it, as the
 * `cookQuestion` controls `PreparationSteps` renders. Shared by the planned
 * view (`MealDetailModal`) and the My recipes view (`RecipeDetailModal`,
 * HON-1339).
 *
 * The step (HON-969) or the item in "You'll need" (HON-983) whose question
 * panel is open, one at a time across both. Opening or closing a panel drops
 * the answer on screen, so the question is reset each time. A question in
 * flight for steps that were replaced cannot show: the next panel to open
 * resets it first.
 */
export function useCookQuestionPanel(target: UseCookQuestionOptions) {
  const [openSubject, setOpenSubject] = useState<CookQuestionSubject | null>(null)
  const { ask, active, previous, isPending, isStreaming, error, retry, reset } =
    useCookQuestion(target)

  const onOpenSubject = useCallback(
    (subject: CookQuestionSubject) => {
      reset()
      setOpenSubject(subject)
    },
    [reset],
  )
  const onClose = useCallback(() => {
    reset()
    setOpenSubject(null)
  }, [reset])

  /**
   * Ticking the step whose panel is open closes the panel (HON-982): the cook
   * has moved on. Focus stays on the toggle, which is outside the panel, so
   * it is not handed to the ⋯ button as Close does.
   */
  const closeForTickedStep = useCallback(
    (index: number) => {
      if (sameSubject(openSubject, { kind: 'step', index })) onClose()
    },
    [openSubject, onClose],
  )

  const controls: CookQuestionControls = {
    openSubject,
    onOpenSubject,
    onClose,
    ask,
    active,
    previous,
    isPending,
    isStreaming,
    error,
    onRetry: retry,
  }

  return {
    controls,
    closeForTickedStep,
    /**
     * Forget the open panel without a reset, safe to call during render: an
     * open panel points at a step or an item of lists that were replaced.
     */
    forgetOpenSubject: () => setOpenSubject(null),
  }
}
