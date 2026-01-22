import { Card, CardContent } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { MealCard } from './MealCard'
import { EmptySlotCard } from './EmptySlotCard'
import { cn } from '@/lib/utils'
import type { EmptySlot, PantryIngredient, PantryItemFull, PlanEntry } from './types'
import type { MealType } from '@/generated/prisma/enums'

const MEAL_TYPE_ORDER: Record<MealType, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
}

type FilledSlot = { type: 'filled'; entry: PlanEntry }
type EmptySlotItem = { type: 'empty'; slot: EmptySlot }
type SlotItem = FilledSlot | EmptySlotItem

interface DayColumnProps {
  date: string
  planId: string
  entries: PlanEntry[]
  emptySlots?: EmptySlot[]
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
  emptySlots = [],
  isToday,
  isPast,
  householdSize,
  isReadOnly,
  pantryIngredients = [],
  pantryItems = [],
}: DayColumnProps) {
  // Combine entries and empty slots (if not past) into a sorted list
  const slots: SlotItem[] = [
    ...entries.map((entry): FilledSlot => ({ type: 'filled', entry })),
    ...(!isPast ? emptySlots.map((slot): EmptySlotItem => ({ type: 'empty', slot })) : []),
  ]

  // Sort by meal type order (breakfast → lunch → dinner)
  slots.sort((a, b) => {
    const mealTypeA = a.type === 'filled' ? a.entry.mealType : a.slot.mealType
    const mealTypeB = b.type === 'filled' ? b.entry.mealType : b.slot.mealType
    return MEAL_TYPE_ORDER[mealTypeA] - MEAL_TYPE_ORDER[mealTypeB]
  })

  return (
    <div className="flex min-w-[120px] flex-col gap-1.5">
      <Heading
        variant="h4"
        className={cn(
          'text-center text-xs',
          isToday && 'text-primary bg-primary/10 rounded py-0.5 font-bold',
        )}
      >
        {formatDayHeader(date)}
      </Heading>
      <div className="flex flex-col gap-1.5">
        {slots.map((item) =>
          item.type === 'filled' ? (
            <MealCard
              key={item.entry.id}
              entryId={item.entry.id}
              planId={planId}
              meal={item.entry.meal}
              mealType={item.entry.mealType}
              status={item.entry.status}
              householdSize={householdSize}
              isReadOnly={isReadOnly}
              isPast={isPast}
              pantryIngredients={pantryIngredients}
              pantryItems={pantryItems}
            />
          ) : (
            <EmptySlotCard
              key={`empty-${item.slot.mealType}`}
              planId={planId}
              date={item.slot.date}
              mealType={item.slot.mealType}
            />
          ),
        )}
        {slots.length === 0 && (
          <Card className="gap-2 py-2">
            <CardContent className="flex items-center justify-center px-3">
              <Body variant="muted" className="text-xs">
                No meal planned
              </Body>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
