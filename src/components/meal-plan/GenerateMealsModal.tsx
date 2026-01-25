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
}

export function GenerateMealsModal({
  open,
  onOpenChange,
  planId,
  weekContext,
}: GenerateMealsModalProps) {
  const router = useRouter()
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async (mode: 'fill-empty' | 'generate') => {
    setIsGenerating(true)
    setError(null)
    onOpenChange(false) // Close modal immediately to show overlay

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

    try {
      const body = mode === 'fill-empty' ? { mode, planId } : { mode, targetWeek: weekContext.type }

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

      setIsGenerating(false)
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
