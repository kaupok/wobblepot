'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { GeneratingOverlay } from './GeneratingOverlay'
import type { WeekContext } from './types'

const CLIENT_TIMEOUT_MS = 45000

function getErrorMessage(status: number, message?: string): string {
  switch (status) {
    case 400:
      return message || 'No empty slots to fill.'
    case 404:
      return 'Meal plan not found.'
    case 422:
      return message || 'Could not generate meals. Please try again.'
    case 429:
      return 'Rate limit exceeded. Please try again later.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

interface GenerateMealsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planId: string
  weekContext: WeekContext
  weekStartDate: string
  weekEndDate: string
}

export function GenerateMealsModal({
  open,
  onOpenChange,
  planId,
  weekContext: _weekContext,
  weekStartDate,
  weekEndDate,
}: GenerateMealsModalProps) {
  const router = useRouter()
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  const handleGenerate = async (mode: 'fill-empty' | 'generate') => {
    setIsGenerating(true)
    setError(null)
    setWarnings([])
    onOpenChange(false) // Close modal immediately to show overlay

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

    try {
      const body =
        mode === 'fill-empty'
          ? { mode, planId, startDate: weekStartDate, endDate: weekEndDate }
          : { mode, startDate: weekStartDate, endDate: weekEndDate }

      const response = await fetch('/api/meal-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw { status: response.status, message: data.message }
      }

      const data = await response.json().catch(() => ({}))

      setIsGenerating(false)

      // Show warnings if any slots couldn't be filled
      if (data.warnings?.length > 0) {
        setWarnings(data.warnings)
        onOpenChange(true)
      }

      router.refresh()
    } catch (err) {
      clearTimeout(timeoutId)
      setIsGenerating(false)

      if (err instanceof Error && err.name === 'AbortError') {
        setError('Generation timed out. Please try again.')
        onOpenChange(true) // Reopen modal to show error
        return
      }

      if (typeof err === 'object' && err !== null && 'status' in err) {
        const e = err as { status: number; message?: string }
        setError(getErrorMessage(e.status, e.message))
        onOpenChange(true) // Reopen modal to show error
        return
      }

      setError('Something went wrong. Please try again.')
      onOpenChange(true) // Reopen modal to show error
    }
  }

  return (
    <>
      {isGenerating && <GeneratingOverlay />}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate meals</DialogTitle>
            <DialogDescription>Choose how to fill your meal plan for this week.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {error && (
              <Body variant="small" className="text-destructive">
                {error}
              </Body>
            )}
            {warnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
                <Body variant="small" className="font-medium text-amber-800 dark:text-amber-200">
                  Some slots could not be filled:
                </Body>
                <ul className="mt-1 list-inside list-disc">
                  {warnings.map((warning) => (
                    <li key={warning} className="text-xs text-amber-700 dark:text-amber-300">
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-col gap-3">
              <Button onClick={() => handleGenerate('fill-empty')} disabled={isGenerating}>
                Fill empty slots
              </Button>
              <Body variant="muted" className="text-center text-xs">
                Generate AI meals only for slots without entries
              </Body>
            </div>
            <div className="flex flex-col gap-3">
              <Button
                variant="outline"
                onClick={() => handleGenerate('generate')}
                disabled={isGenerating}
              >
                Reset & regenerate
              </Button>
              <Body variant="muted" className="text-center text-xs">
                Delete all entries and generate a new plan from scratch
              </Body>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
