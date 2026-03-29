'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GeneratingOverlay } from '@/components/meal-plan/GeneratingOverlay'
import { computeEndDate } from '@/lib/meal-planning/day-picker'

const CLIENT_TIMEOUT_MS = 45000

const DAY_OPTIONS = [
  { value: '3', label: '3 days' },
  { value: '5', label: '5 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
]

interface FillDaysActionProps {
  planId: string
  firstEmptyDate: string // YYYY-MM-DD
}

export function FillDaysAction({ planId, firstEmptyDate }: FillDaysActionProps) {
  const router = useRouter()
  const [days, setDays] = useState('7')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFill() {
    setIsGenerating(true)
    setError(null)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

    try {
      const endDate = computeEndDate(firstEmptyDate, Number(days))
      const response = await fetch('/api/meal-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'fill-empty',
          planId,
          startDate: firstEmptyDate,
          endDate,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        if (response.status === 429) {
          setError('Rate limit exceeded. Please try again later.')
        } else {
          setError(data.message || 'Failed to generate meals. Please try again.')
        }
        return
      }

      router.refresh()
    } catch (err) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Generation timed out. Please try again.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <>
      {isGenerating && <GeneratingOverlay />}
      <div className="bg-muted/50 flex flex-col gap-2 rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <Sparkles className="text-primary h-4 w-4 shrink-0" />
          <div className="flex flex-1 items-center gap-2">
            <Body variant="small" className="shrink-0">
              Fill next
            </Body>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="h-8 w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={handleFill} disabled={isGenerating}>
            {isGenerating ? 'Generating...' : 'Generate'}
          </Button>
        </div>
        {error && (
          <Body variant="small" className="text-destructive">
            {error}
          </Body>
        )}
      </div>
    </>
  )
}
