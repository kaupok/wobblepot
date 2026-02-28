'use client'

import { Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { StructuredTips } from '@/components/meal-plan/types'

interface PreparationTipsProps {
  tips: StructuredTips | null
  isLoading: boolean
  error: string | null
  onRetry: () => void
  preparationNotes?: string | null
}

function UserNotes({ notes }: { notes: string }) {
  return (
    <div className="flex flex-col gap-1 border-t pt-4">
      <Body variant="small" className="font-medium">
        Your notes
      </Body>
      <Body variant="small" className="text-muted-foreground whitespace-pre-line">
        {notes}
      </Body>
    </div>
  )
}

export function PreparationTips({
  tips,
  isLoading,
  error,
  onRetry,
  preparationNotes,
}: PreparationTipsProps) {
  const hasNotes = !!preparationNotes?.trim()

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {hasNotes && <UserNotes notes={preparationNotes!} />}
        <div className="flex flex-col gap-4 border-t pt-4">
          <div className="flex flex-col gap-2">
            <Body variant="small" className="font-medium">
              {hasNotes ? 'Additional tips' : 'Equipment needed'}
            </Body>
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
          {!hasNotes && (
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
          )}
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
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        {hasNotes && <UserNotes notes={preparationNotes!} />}
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
      </div>
    )
  }

  if (!tips && !hasNotes) {
    return null
  }

  if (!tips) {
    if (hasNotes) {
      return <UserNotes notes={preparationNotes!} />
    }
    return null
  }

  return (
    <div className="flex flex-col gap-4">
      {hasNotes && <UserNotes notes={preparationNotes!} />}
      <div className="flex flex-col gap-4 border-t pt-4">
        {tips.equipment && tips.equipment.length > 0 && (
          <div className="flex flex-col gap-1">
            <Body variant="small" className="font-medium">
              Equipment needed
            </Body>
            <ul className="text-muted-foreground list-disc pl-5 text-sm">
              {tips.equipment.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {tips.steps && tips.steps.length > 0 && (
          <div className="flex flex-col gap-1">
            <Body variant="small" className="font-medium">
              Steps
            </Body>
            <ol className="text-muted-foreground list-decimal pl-5 text-sm">
              {tips.steps.map((step, i) => (
                <li key={i} className="mb-1">
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}
        {tips.pitfalls.length > 0 && (
          <div className="flex flex-col gap-1">
            <Body variant="small" className="font-medium">
              Watch out for
            </Body>
            <ul className="text-muted-foreground list-disc pl-5 text-sm">
              {tips.pitfalls.map((pitfall, i) => (
                <li key={i}>{pitfall}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="border-primary/20 bg-primary/5 rounded-md border-l-4 px-3 py-2">
          <Body variant="small" className="font-medium">
            Tip
          </Body>
          <Body variant="small" className="text-muted-foreground">
            {tips.tip}
          </Body>
        </div>
      </div>
    </div>
  )
}
