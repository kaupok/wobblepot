'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { track, type Source } from '@/lib/analytics'
import type { MealData, MealStatus } from './types'

interface UseEntryStatusOptions {
  planId: string
  entryId: string
  meal: MealData | null
  initialStatus: MealStatus
  /** The pantry was already charged for this entry — see `PlanEntry.pantryDeducted`. */
  pantryDeducted?: boolean
  /** Where a status change came from, unless the call names its own. */
  source: Source
  /** The server dropped the entry's cached tips on the way out of `completed`. */
  onLeaveCompleted?: () => void
  /** A completion went through, with or without a deduction. */
  onCompleted?: () => void
}

/**
 * An entry's status and the rules for changing it, shared by the planner card
 * and the past-meals row (HON-1018): the optimistic update and its revert, the
 * completion analytics, and the pantry deduction that a completion previews
 * unless the entry was already charged (HON-651). The caller renders
 * `PantryDeductionModal` from `isDeductionModalOpen`.
 */
export function useEntryStatus({
  planId,
  entryId,
  meal,
  initialStatus,
  pantryDeducted = false,
  source: defaultSource,
  onLeaveCompleted,
  onCompleted,
}: UseEntryStatusOptions) {
  const router = useRouter()
  const tCard = useTranslations('meal-plan.card')
  const [status, setStatus] = useState<MealStatus>(initialStatus)
  const [isDeductionModalOpen, setIsDeductionModalOpen] = useState(false)
  // Set when a deduction confirmed here went through, so a revert and
  // re-complete before `router.refresh()` lands does not preview it again.
  const [chargedHere, setChargedHere] = useState(false)
  const isPantryCharged = pantryDeducted || chargedHere
  // Where a completion started, read when the deduction is confirmed: the
  // caller's own control, or "Done cooking" in the cook view.
  const completionSourceRef = useRef<Source>(defaultSource)

  const statusMutation = useMutation({
    mutationFn: async ({
      newStatus,
      deductPantry = false,
    }: {
      newStatus: MealStatus
      deductPantry?: boolean
      source?: Source
    }) => {
      const data = await apiFetch<{ pantryDeducted?: boolean }>(
        `/api/meal-plans/${planId}/entries/${entryId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus, deductPantry }),
        },
      )
      return { newStatus, deductPantry, pantryDeducted: data.pantryDeducted === true }
    },
    onMutate: async ({ newStatus }) => {
      const previousStatus = status
      // Optimistic update
      setStatus(newStatus)
      return { previousStatus }
    },
    onSuccess: ({ newStatus }, { source = defaultSource }, context) => {
      if (context?.previousStatus === 'completed' && newStatus !== 'completed') {
        onLeaveCompleted?.()
      }

      // Every status change, not only a confirmed deduction: the header counts
      // the past meals still to mark, and this re-renders it so the account
      // menu's dot clears (HON-1028). A deduction also changes the pantry.
      router.refresh()

      // Fire status-transition analytics from `onSuccess` so we don't track
      // optimistic updates that the server later rejected (the optimistic
      // state is reverted in `onError`).
      if (!meal) return
      if (newStatus === 'completed') {
        void track('meal_plan:meal_completed', {
          plan_id: planId,
          meal_id: meal.id,
          source,
        })
      } else if (newStatus === 'skipped') {
        void track('meal_plan:meal_skipped', {
          plan_id: planId,
          meal_id: meal.id,
          source,
        })
      }
    },
    onError: (_err, _vars, context) => {
      // Revert on error
      if (context?.previousStatus) {
        setStatus(context.previousStatus)
      }
      toast.error(tCard('statusUpdateFailed'))
    },
  })

  function handleStatusChange(newStatus: MealStatus, source: Source = defaultSource) {
    if (newStatus === 'completed' && meal) {
      completionSourceRef.current = source
      // The server charges an entry at most once — reverting does not restock,
      // and nothing clears the marker (HON-651). Previewing a deduction here
      // would ask the user to confirm a change that never happens, so an
      // already-charged entry completes directly.
      if (isPantryCharged) {
        statusMutation.mutate({ newStatus, source }, { onSuccess: () => onCompleted?.() })
        return
      }

      // Intercept "completed" status to show deduction modal
      setIsDeductionModalOpen(true)
      return
    }

    // For other statuses, update directly
    statusMutation.mutate({ newStatus, source })
  }

  function handleDeductionConfirm() {
    statusMutation.mutate(
      { newStatus: 'completed', deductPantry: true, source: completionSourceRef.current },
      {
        onSuccess: ({ pantryDeducted: charged }) => {
          if (charged) setChargedHere(true)
          setIsDeductionModalOpen(false)
          onCompleted?.()
        },
      },
    )
  }

  return {
    status,
    isUpdating: statusMutation.isPending,
    isDeductionModalOpen,
    setIsDeductionModalOpen,
    handleStatusChange,
    handleDeductionConfirm,
  }
}
