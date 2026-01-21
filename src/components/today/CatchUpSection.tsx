'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'
import { MealStatusPrompt } from './MealStatusPrompt'
import { PantryDeductionModal } from '@/components/meal-plan/PantryDeductionModal'
import { formatCatchUpLabel } from '@/lib/meal-planning/dates'
import type { PlanEntry, PantryItemFull } from '@/components/meal-plan/types'
import type { MealStatus } from '@/components/meal-plan/StatusSelect'

interface CatchUpEntry extends PlanEntry {
  label: string
}

interface CatchUpSectionProps {
  entries: CatchUpEntry[]
  planId: string
  pantryItems: PantryItemFull[]
  householdSize: number
}

export function CatchUpSection({
  entries,
  planId,
  pantryItems,
  householdSize,
}: CatchUpSectionProps) {
  const router = useRouter()
  const [updatingEntryId, setUpdatingEntryId] = useState<string | null>(null)
  const [deductionEntry, setDeductionEntry] = useState<CatchUpEntry | null>(null)
  const [locallyUpdatedIds, setLocallyUpdatedIds] = useState<Set<string>>(new Set())

  async function updateStatus(
    entryId: string,
    newStatus: MealStatus,
    deductPantry: boolean = false,
  ) {
    setUpdatingEntryId(entryId)

    try {
      const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, deductPantry }),
      })

      if (!response.ok) {
        toast.error('Failed to update status. Please try again.')
        return false
      }

      // Mark as locally updated to hide from list
      setLocallyUpdatedIds((prev) => new Set(prev).add(entryId))
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

  function handleSkipped(entryId: string) {
    updateStatus(entryId, 'skipped')
  }

  async function handleDeductionConfirm() {
    if (!deductionEntry) return

    const success = await updateStatus(deductionEntry.id, 'completed', true)
    if (success) {
      setDeductionEntry(null)
      router.refresh()
    }
  }

  // Filter out locally updated entries
  const visibleEntries = entries.filter((entry) => !locallyUpdatedIds.has(entry.id))

  if (visibleEntries.length === 0) {
    return null
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <Body variant="muted">Catch up on past meals</Body>
        {visibleEntries.map((entry) => (
          <Card key={entry.id}>
            <CardHeader className="pb-2">
              <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                {entry.label}
              </div>
              <div className="text-sm leading-tight font-semibold">{entry.meal?.name}</div>
            </CardHeader>
            <CardContent className="pb-3">
              {entry.meal && (
                <MealStatusPrompt
                  mealName={entry.meal.name}
                  onMadeIt={() => handleMadeIt(entry)}
                  onSkipped={() => handleSkipped(entry.id)}
                  disabled={updatingEntryId === entry.id}
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {deductionEntry?.meal && (
        <PantryDeductionModal
          open={!!deductionEntry}
          onOpenChange={(open) => !open && setDeductionEntry(null)}
          mealName={deductionEntry.meal.name}
          components={deductionEntry.meal.components}
          householdSize={householdSize}
          pantryItems={pantryItems}
          onConfirm={handleDeductionConfirm}
          isLoading={updatingEntryId === deductionEntry.id}
        />
      )}
    </>
  )
}

export { formatCatchUpLabel }
