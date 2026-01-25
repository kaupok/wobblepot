'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { GeneratingOverlay } from './GeneratingOverlay'
import type { WeekContext } from './types'

const CLIENT_TIMEOUT_MS = 45000

type GenerateMode = 'generate' | 'empty'

function getErrorMessage(status: number, message?: string): string {
  switch (status) {
    case 429:
      return 'Rate limit exceeded. Please try again later.'
    case 409:
      return 'A meal plan already exists for this week.'
    case 422:
      return message || 'Could not generate a meal plan. Please try again.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

interface EmptyPlanProps {
  weekContext: WeekContext
}

export function EmptyPlan({ weekContext }: EmptyPlanProps) {
  const router = useRouter()
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async (mode: GenerateMode) => {
    setIsGenerating(true)
    setError(null)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

    try {
      const response = await fetch('/api/meal-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetWeek: weekContext.type, mode }),
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
        return
      }

      if (typeof err === 'object' && err !== null && 'status' in err) {
        const e = err as { status: number; message?: string }
        setError(getErrorMessage(e.status, e.message))
        return
      }

      setError('Something went wrong. Please try again.')
    }
  }

  // Dynamic content based on week type
  const isCurrentWeek = weekContext.type === 'current'
  const heading = isCurrentWeek ? 'No meal plan for this week' : 'No meal plan for next week'
  const description = isCurrentWeek
    ? weekContext.isPartialWeek
      ? `Generate a plan for the remaining ${weekContext.daysCount} days of this week.`
      : 'Generate your meal plan for this week to get started.'
    : 'Generate your meal plan for next week.'
  const buttonText = isCurrentWeek ? 'Generate this week' : 'Generate next week'

  return (
    <>
      {isGenerating && <GeneratingOverlay />}
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Heading variant="h2">{heading}</Heading>
          <Body variant="muted">{description}</Body>
        </div>
        {error && (
          <Body variant="small" className="text-destructive">
            {error}
          </Body>
        )}
        <div className="flex flex-col items-center gap-3">
          <Button onClick={() => handleGenerate('generate')} disabled={isGenerating}>
            {isGenerating ? 'Generating...' : buttonText}
          </Button>
          <button
            onClick={() => handleGenerate('empty')}
            disabled={isGenerating}
            className="text-muted-foreground hover:text-foreground text-sm underline disabled:opacity-50"
          >
            or create empty week
          </button>
        </div>
      </div>
    </>
  )
}
