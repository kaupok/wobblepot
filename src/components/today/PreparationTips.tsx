'use client'

import { Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface PreparationTipsProps {
  tips: string | null
  isLoading: boolean
  error: string | null
  onRetry: () => void
}

export function PreparationTips({ tips, isLoading, error, onRetry }: PreparationTipsProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 border-t pt-4">
        <Body variant="small" className="font-medium">
          Preparation tips
        </Body>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-10/12" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-9/12" />
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

  if (!tips) {
    return null
  }

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
