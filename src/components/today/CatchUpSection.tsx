'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { PantryDeductionModal } from '@/components/meal-plan/PantryDeductionModal'
import { MealRatingPrompt } from '@/components/meal-plan/MealRating'
import { formatCatchUpLabel } from '@/lib/meal-planning/dates'
import type { PlanEntry, PantryItemFull } from '@/components/meal-plan/types'
import type { MealStatus } from '@/components/meal-plan/StatusSelect'

interface CatchUpEntry extends PlanEntry {
  label: string
  planId: string
}

interface CatchUpSectionProps {
  entries: CatchUpEntry[]
  pantryItems: PantryItemFull[]
  householdSize: number
}

export function CatchUpSection({ entries, pantryItems, householdSize }: CatchUpSectionProps) {
  const router = useRouter()
  const [updatingEntryId, setUpdatingEntryId] = useState<string | null>(null)
  const [deductionEntry, setDeductionEntry] = useState<CatchUpEntry | null>(null)
  const [locallyUpdatedIds, setLocallyUpdatedIds] = useState<Set<string>>(new Set())
  const [ratingEntryId, setRatingEntryId] = useState<string | null>(null)

  async function updateStatus(
    entry: CatchUpEntry,
    newStatus: MealStatus,
    deductPantry: boolean = false,
  ) {
    setUpdatingEntryId(entry.id)

    try {
      const response = await fetch(`/api/meal-plans/${entry.planId}/entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, deductPantry }),
      })

      if (!response.ok) {
        toast.error('Failed to update status. Please try again.')
        return false
      }

      // Mark as locally updated to hide from list
      setLocallyUpdatedIds((prev) => new Set(prev).add(entry.id))
      return true
    } catch {
      toast.error('Failed to update status. Please try again.')
      return false
    } finally {
      setUpdatingEntryId(null)
    }
  }

  function handleMadeIt(entry: CatchUpEntry) {
    setDeductionEntry(entry)
  }

  function handleSkipped(entry: CatchUpEntry) {
    updateStatus(entry, 'skipped')
  }

  async function handleDeductionConfirm() {
    if (!deductionEntry) return

    const success = await updateStatus(deductionEntry, 'completed', true)
    if (success) {
      const entryId = deductionEntry.id
      setDeductionEntry(null)
      // Show rating prompt instead of immediately hiding
      setRatingEntryId(entryId)
      router.refresh()
    }
  }

  function handleRatingDone(entryId: string) {
    setRatingEntryId(null)
    setLocallyUpdatedIds((prev) => new Set(prev).add(entryId))
  }

  // Filter out locally updated entries
  const visibleEntries = entries.filter((entry) => !locallyUpdatedIds.has(entry.id))

  if (visibleEntries.length === 0) {
    return null
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Body variant="muted">Catch up on past meals</Body>
        <div className="divide-border rounded-lg border">
          {visibleEntries.map((entry) => {
            const isUpdating = updatingEntryId === entry.id
            const isRating = ratingEntryId === entry.id
            return (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                    {entry.label}
                  </div>
                  <div className="truncate text-sm font-semibold">{entry.meal?.name}</div>
                </div>
                {isRating && entry.meal ? (
                  <div className="shrink-0">
                    <MealRatingPrompt
                      planId={entry.planId}
                      entryId={entry.id}
                      onRated={() => handleRatingDone(entry.id)}
                      onDismiss={() => handleRatingDone(entry.id)}
                    />
                  </div>
                ) : (
                  entry.meal && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleMadeIt(entry)}
                        disabled={isUpdating}
                      >
                        Made it
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSkipped(entry)}
                        disabled={isUpdating}
                      >
                        Skipped
                      </Button>
                    </div>
                  )
                )}
              </div>
            )
          })}
        </div>
      </div>
      {deductionEntry?.meal && (
        <PantryDeductionModal
          open={!!deductionEntry}
          onOpenChange={(open) => !open && setDeductionEntry(null)}
          mealName={deductionEntry.meal.name}
          components={deductionEntry.meal.components}
          householdSize={deductionEntry.servingOverride ?? householdSize}
          pantryItems={pantryItems}
          onConfirm={handleDeductionConfirm}
          isLoading={updatingEntryId === deductionEntry.id}
        />
      )}
    </>
  )
}

export { formatCatchUpLabel }
