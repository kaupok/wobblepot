'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Body } from '@/components/ui/typography'

interface ClearWeekModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planId: string
}

export function ClearWeekModal({ open, onOpenChange, planId }: ClearWeekModalProps) {
  const router = useRouter()
  const [isClearing, setIsClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClear = async () => {
    setIsClearing(true)
    setError(null)

    try {
      const response = await fetch(`/api/meal-plans/${planId}/entries`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to clear meals')
      }

      setIsClearing(false)
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      setIsClearing(false)
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear all meals?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove all meals from this week. You can add meals manually or generate new
            ones.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Body variant="small" className="text-destructive">
            {error}
          </Body>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleClear()
            }}
            disabled={isClearing}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isClearing ? 'Clearing...' : 'Clear'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
