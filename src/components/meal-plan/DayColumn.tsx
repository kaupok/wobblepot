import { Card, CardContent } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { MealCard } from './MealCard'
import { cn } from '@/lib/utils'
import type { PantryIngredient, PantryItemFull, PlanEntry } from './types'

interface DayColumnProps {
  date: string
  planId: string
  entries: PlanEntry[]
  isToday: boolean
  isPast?: boolean
  householdSize: number
  isReadOnly?: boolean
  pantryIngredients?: PantryIngredient[]
  pantryItems?: PantryItemFull[]
}

function formatDayHeader(dateString: string): string {
  const date = new Date(dateString + 'T12:00:00') // Use noon to avoid timezone issues
  const dayName = date.toLocaleDateString('en-US', { weekday: 'short' })
  const dayNumber = date.getDate()
  return `${dayName} ${dayNumber}`
}

export function DayColumn({
  date,
  planId,
  entries,
  isToday,
  isPast,
  householdSize,
  isReadOnly,
  pantryIngredients = [],
  pantryItems = [],
}: DayColumnProps) {
  return (
    <div
      className={cn(
        'flex min-w-[140px] flex-col gap-2 rounded-lg p-2',
        isToday && 'bg-primary/5 ring-primary/30 ring-1',
      )}
    >
      <Heading variant="h4" className={cn('text-center text-sm', isToday && 'text-primary')}>
        {formatDayHeader(date)}
      </Heading>
      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <MealCard
            key={entry.id}
            entryId={entry.id}
            planId={planId}
            meal={entry.meal}
            mealType={entry.mealType}
            status={entry.status}
            householdSize={householdSize}
            isReadOnly={isReadOnly}
            isPast={isPast}
            pantryIngredients={pantryIngredients}
            pantryItems={pantryItems}
          />
        ))}
        {entries.length === 0 && (
          <Card>
            <CardContent className="flex items-center justify-center">
              <Body variant="muted">No meal planned</Body>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
