'use client'

import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'

interface MealStatusPromptProps {
  mealName: string
  onMadeIt: () => void
  onSkipped: () => void
  disabled?: boolean
}

export function MealStatusPrompt({
  mealName,
  onMadeIt,
  onSkipped,
  disabled,
}: MealStatusPromptProps) {
  return (
    <div className="bg-muted/50 flex flex-col gap-2 rounded-lg p-3">
      <Body variant="small">Did you make {mealName}?</Body>
      <div className="flex gap-2">
        <Button variant="default" size="sm" onClick={onMadeIt} disabled={disabled}>
          Yes, made it
        </Button>
        <Button variant="outline" size="sm" onClick={onSkipped} disabled={disabled}>
          No, skipped
        </Button>
      </div>
    </div>
  )
}
