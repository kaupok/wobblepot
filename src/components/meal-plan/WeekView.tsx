import { Heading, Body } from '@/components/ui/typography'
import { getTodayInTimezone } from '@/lib/meal-planning/dates'
import { shouldEnforceBalanceConstraints } from '@/lib/meal-planning/slots'
import { DayColumn } from './DayColumn'
import type { MealPlan, PantryIngredient, PlanEntry, WeekContext } from './types'

interface WeekViewProps {
  plan: MealPlan
  householdSize: number
  weekContext: WeekContext
  timezone: string
  isReadOnly?: boolean
  pantryIngredients?: PantryIngredient[]
}

export function WeekView({
  plan,
  householdSize,
  weekContext,
  timezone,
  isReadOnly,
  pantryIngredients = [],
}: WeekViewProps) {
  const today = getTodayInTimezone(timezone)

  // Get unique dates from plan entries (handles partial weeks correctly)
  const entryDates = [...new Set(plan.entries.map((e) => e.date))].sort()

  // Group entries by date
  const entriesByDate = new Map<string, PlanEntry[]>()
  for (const date of entryDates) {
    entriesByDate.set(date, [])
  }
  for (const entry of plan.entries) {
    const existing = entriesByDate.get(entry.date)
    if (existing) {
      existing.push(entry)
    }
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
        {entryDates.map((date) => (
          <DayColumn
            key={date}
            date={date}
            planId={plan.id}
            entries={entriesByDate.get(date) ?? []}
            isToday={date === today}
            householdSize={householdSize}
            isReadOnly={isReadOnly}
            pantryIngredients={pantryIngredients}
          />
        ))}
      </div>
    </div>
  )
}
