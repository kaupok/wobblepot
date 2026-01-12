import { Card, CardContent } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { MealCard } from './MealCard'
import { cn } from '@/lib/utils'
import type { MealStatus } from './StatusSelect'

interface PlanEntry {
  id: string
  date: string
  status: MealStatus
  meal: {
    id: string
    name: string
    kidFriendly: boolean
    timeMinutes?: number | null
  } | null
}

interface DayColumnProps {
  date: string
  planId: string
  entries: PlanEntry[]
  isToday: boolean
}

function formatDayHeader(dateString: string): string {
  const date = new Date(dateString + 'T12:00:00') // Use noon to avoid timezone issues
  const dayName = date.toLocaleDateString('en-US', { weekday: 'short' })
  const dayNumber = date.getDate()
  return `${dayName} ${dayNumber}`
}

export function DayColumn({ date, planId, entries, isToday }: DayColumnProps) {
  return (
    <div
      className={cn(
        'flex min-w-[160px] flex-col gap-3 rounded-lg p-3',
        isToday && 'ring-primary ring-2 ring-offset-2',
      )}
    >
      <Heading variant="h4" className={cn('text-center', isToday && 'text-primary')}>
        {formatDayHeader(date)}
      </Heading>
      <div className="flex flex-col gap-3">
        {entries.map((entry) => (
          <MealCard
            key={entry.id}
            entryId={entry.id}
            planId={planId}
            meal={entry.meal}
            status={entry.status}
          />
        ))}
        {entries.length === 0 && (
          <Card className="py-4">
            <CardContent className="flex items-center justify-center">
              <Body variant="muted">No meal planned</Body>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
