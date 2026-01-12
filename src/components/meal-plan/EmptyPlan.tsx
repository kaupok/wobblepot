'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { GeneratingOverlay } from './GeneratingOverlay'

const CLIENT_TIMEOUT_MS = 45000

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

export function EmptyPlan() {
  const router = useRouter()
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    setIsGenerating(true)
    setError(null)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

    try {
      const response = await fetch('/api/meal-plans/generate', {
        method: 'POST',
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

  return (
    <>
      {isGenerating && <GeneratingOverlay />}
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Heading variant="h2">No meal plan for this week</Heading>
          <Body variant="muted">Generate your first meal plan to get started.</Body>
        </div>
        {error && (
          <Body variant="small" className="text-destructive">
            {error}
          </Body>
        )}
        <Button onClick={handleGenerate} disabled={isGenerating}>
          {isGenerating ? 'Generating...' : 'Generate meal plan'}
        </Button>
      </div>
    </>
  )
}
