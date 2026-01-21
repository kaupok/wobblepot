'use client'

import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import type { MealStatus } from '@/components/meal-plan/StatusSelect'

interface MealStatusPromptProps {
  mealName: string
  onMadeIt: () => void
  onSkipped: () => void
  onCancel?: () => void
  disabled?: boolean
  /** Current status when changing (shows different prompt text) */
  currentStatus?: MealStatus
}

export function MealStatusPrompt({
  mealName,
  onMadeIt,
  onSkipped,
  onCancel,
  disabled,
  currentStatus,
}: MealStatusPromptProps) {
  const isChanging = currentStatus === 'completed' || currentStatus === 'skipped'
  const promptText = isChanging ? `Change status for ${mealName}?` : `Did you make ${mealName}?`

  return (
    <div className="bg-muted/50 flex flex-col gap-2 rounded-lg p-3">
      <Body variant="small">{promptText}</Body>
      <div className="flex gap-2">
        <Button variant="default" size="sm" onClick={onMadeIt} disabled={disabled}>
          {currentStatus === 'completed' ? '✓ Made it' : 'Yes, made it'}
        </Button>
        <Button variant="outline" size="sm" onClick={onSkipped} disabled={disabled}>
          {currentStatus === 'skipped' ? 'Skipped' : 'No, skipped'}
        </Button>
        {isChanging && onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={disabled}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}
