'use client'

import { useMemo } from 'react'
import { Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface PreparationTipsProps {
  tips: string | null
  isLoading: boolean
  error: string | null
  onRetry: () => void
}

interface ParsedTips {
  equipment: string | null
  steps: string | null
  mistakes: string | null
  tip: string | null
}

function parseTips(tips: string): ParsedTips {
  const result: ParsedTips = {
    equipment: null,
    steps: null,
    mistakes: null,
    tip: null,
  }

  // Normalize line endings and remove markdown bold markers
  const text = tips.replace(/\r\n/g, '\n').replace(/\*\*/g, '')

  // Extract sections using regex patterns
  const equipmentMatch = text.match(
    /Equipment needed:?\s*([\s\S]*?)(?=Steps:|Watch out for:|Tip:|$)/i,
  )
  const stepsMatch = text.match(/Steps:?\s*([\s\S]*?)(?=Watch out for:|Tip:|$)/i)
  const mistakesMatch = text.match(/Watch out for:?\s*([\s\S]*?)(?=Tip:|$)/i)
  const tipMatch = text.match(/Tip:?\s*([\s\S]*?)$/i)

  if (equipmentMatch?.[1]) {
    result.equipment = equipmentMatch[1].trim()
  }
  if (stepsMatch?.[1]) {
    result.steps = stepsMatch[1].trim()
  }
  if (mistakesMatch?.[1]) {
    result.mistakes = mistakesMatch[1].trim()
  }
  if (tipMatch?.[1]) {
    result.tip = tipMatch[1].trim()
  }

  return result
}

export function PreparationTips({ tips, isLoading, error, onRetry }: PreparationTipsProps) {
  const parsed = useMemo(() => (tips ? parseTips(tips) : null), [tips])

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 border-t pt-4">
        <div className="flex flex-col gap-2">
          <Body variant="small" className="font-medium">
            Equipment needed
          </Body>
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Body variant="small" className="font-medium">
            Steps
          </Body>
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Body variant="small" className="font-medium">
            Watch out for
          </Body>
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col gap-2 border-t pt-4">
        <Body variant="small" className="font-medium">
          Preparation tips
        </Body>
        <div className="flex items-center gap-2">
          <Body variant="muted">{error}</Body>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (!tips || !parsed) {
    return null
  }

  // Check if we have structured sections or just raw text
  const hasStructuredSections = parsed.equipment || parsed.steps || parsed.mistakes

  if (!hasStructuredSections) {
    // Fallback: render as plain text (backwards compatibility)
    return (
      <div className="flex flex-col gap-2 border-t pt-4">
        <Body variant="small" className="font-medium">
          Preparation tips
        </Body>
        <Body variant="small" className="text-muted-foreground whitespace-pre-line">
          {tips}
        </Body>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 border-t pt-4">
      {parsed.equipment && (
        <div className="flex flex-col gap-1">
          <Body variant="small" className="font-medium">
            Equipment needed
          </Body>
          <Body variant="small" className="text-muted-foreground whitespace-pre-line">
            {parsed.equipment}
          </Body>
        </div>
      )}
      {parsed.steps && (
        <div className="flex flex-col gap-1">
          <Body variant="small" className="font-medium">
            Steps
          </Body>
          <Body variant="small" className="text-muted-foreground whitespace-pre-line">
            {parsed.steps}
          </Body>
        </div>
      )}
      {parsed.mistakes && (
        <div className="flex flex-col gap-1">
          <Body variant="small" className="font-medium">
            Watch out for
          </Body>
          <Body variant="small" className="text-muted-foreground whitespace-pre-line">
            {parsed.mistakes}
          </Body>
        </div>
      )}
      {parsed.tip && (
        <div className="flex flex-col gap-1">
          <Body variant="small" className="font-medium">
            Tip
          </Body>
          <Body variant="small" className="text-muted-foreground whitespace-pre-line">
            {parsed.tip}
          </Body>
        </div>
      )}
    </div>
  )
}
