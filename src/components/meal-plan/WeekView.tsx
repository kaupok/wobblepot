import { Heading, Body } from '@/components/ui/typography'
import {
  getTodayInTimezone,
  getWeekDates,
  parseLocalDate,
  toDateString,
} from '@/lib/meal-planning/dates'
import { shouldEnforceBalanceConstraints } from '@/lib/meal-planning/slots'
import { DayColumn } from './DayColumn'
import type { MealPlan, PantryIngredient, PantryItemFull, PlanEntry, WeekContext } from './types'
import type { MealType } from '@/generated/prisma/enums'

const MEAL_TYPE_ORDER: Record<MealType, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
}

interface WeekViewProps {
  plan: MealPlan
  householdSize: number
  weekContext: WeekContext
  timezone: string
  isReadOnly?: boolean
  pantryIngredients?: PantryIngredient[]
  pantryItems?: PantryItemFull[]
}

export function WeekView({
  plan,
  householdSize,
  weekContext,
  timezone,
  isReadOnly,
  pantryIngredients = [],
  pantryItems = [],
}: WeekViewProps) {
  const today = getTodayInTimezone(timezone)

  // Always generate all 7 days of the week (Mon-Sun) for consistent layout
  const startDate = parseLocalDate(plan.startDate)
  const weekDates = getWeekDates(startDate).map(toDateString)

  // Group entries by date - days without entries will have empty arrays
  const entriesByDate = new Map<string, PlanEntry[]>()
  for (const date of weekDates) {
    entriesByDate.set(date, [])
  }
  for (const entry of plan.entries) {
    const existing = entriesByDate.get(entry.date)
    if (existing) {
      existing.push(entry)
    }
  }

  // Sort entries within each day by meal type (breakfast → lunch → dinner)
  for (const entries of entriesByDate.values()) {
    entries.sort((a, b) => MEAL_TYPE_ORDER[a.mealType] - MEAL_TYPE_ORDER[b.mealType])
  }

  // Dynamic heading based on week context
  const heading =
    weekContext.type === 'last'
      ? "Last week's meals"
      : weekContext.type === 'current'
        ? "This week's meals"
        : "Next week's meals"

  // Show notice for partial weeks with relaxed constraints
  const showPartialWeekNotice =
    weekContext.isPartialWeek && !shouldEnforceBalanceConstraints(weekContext.daysCount)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Heading variant="h2">{heading}</Heading>
        {showPartialWeekNotice && (
          <Body variant="muted">
            Shorter week ({weekContext.daysCount} days) - meal variety may be limited
          </Body>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
        {weekDates.map((date) => (
          <DayColumn
            key={date}
            date={date}
            planId={plan.id}
            entries={entriesByDate.get(date) ?? []}
            isToday={date === today}
            isPast={date < today}
            householdSize={householdSize}
            isReadOnly={isReadOnly}
            pantryIngredients={pantryIngredients}
            pantryItems={pantryItems}
          />
        ))}
      </div>
    </div>
  )
}
