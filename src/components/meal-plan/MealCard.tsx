'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { StatusSelect, type MealStatus } from './StatusSelect'

interface MealCardProps {
  entryId: string
  planId: string
  meal: {
    id: string
    name: string
    kidFriendly: boolean
    timeMinutes?: number | null
  } | null
  status: MealStatus
}

export function MealCard({ entryId, planId, meal, status: initialStatus }: MealCardProps) {
  const [status, setStatus] = useState<MealStatus>(initialStatus)
  const [isUpdating, setIsUpdating] = useState(false)

  async function handleStatusChange(newStatus: MealStatus) {
    const previousStatus = status
    // Optimistic update
    setStatus(newStatus)
    setIsUpdating(true)

    try {
      const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })

      if (!response.ok) {
        // Revert on error
        setStatus(previousStatus)
      }
    } catch {
      // Revert on error
      setStatus(previousStatus)
    } finally {
      setIsUpdating(false)
    }
  }

  if (!meal) {
    return (
      <Card className="py-4">
        <CardContent className="flex items-center justify-center">
          <Body variant="muted">No meal planned</Body>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="py-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{meal.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pb-2">
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          {meal.timeMinutes && <span>{meal.timeMinutes} min</span>}
          {meal.kidFriendly && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
              Kid-friendly
            </span>
          )}
        </div>
        <StatusSelect value={status} onChange={handleStatusChange} disabled={isUpdating} />
      </CardContent>
      <CardFooter className="gap-2 pt-2">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/meals/${meal.id}`}>View</Link>
        </Button>
        <Button variant="outline" size="sm" disabled>
          Swap
        </Button>
      </CardFooter>
    </Card>
  )
}
