'use client'

import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import type { MealStatus } from '@/components/meal-plan/StatusSelect'

interface MealStatusPromptProps {
  mealName: string
  onMadeIt: () => void
  onSkipped: () => void
  onCancel?: () => void
  onReset?: () => void
  disabled?: boolean
  /** Current status when changing (shows different prompt text) */
  currentStatus?: MealStatus
}

export function MealStatusPrompt({
  mealName,
  onMadeIt,
  onSkipped,
  onCancel,
  onReset,
  disabled,
  currentStatus,
}: MealStatusPromptProps) {
  const isChanging = currentStatus === 'completed' || currentStatus === 'skipped'
  const promptText = isChanging ? `Change status for ${mealName}?` : `Did you make ${mealName}?`

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-yellow-50 p-3 dark:bg-yellow-900/20">
      <Body variant="small">{promptText}</Body>
      <div className="flex flex-wrap gap-2">
        <Button variant="default" size="sm" onClick={onMadeIt} disabled={disabled}>
          {currentStatus === 'completed' ? '✓ Made it' : 'Made it'}
        </Button>
        <Button variant="outline" size="sm" onClick={onSkipped} disabled={disabled}>
          Skipped
        </Button>
        {isChanging && onReset && (
          <Button variant="outline" size="sm" onClick={onReset} disabled={disabled}>
            Reset to planned
          </Button>
        )}
        {isChanging && onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={disabled}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}
