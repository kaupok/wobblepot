import { Heading } from '@/components/ui/typography'
import { DayColumn } from './DayColumn'
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

interface MealPlan {
  id: string
  startDate: string
  endDate: string
  entries: PlanEntry[]
}

interface WeekViewProps {
  plan: MealPlan
}

function getTodayString(): string {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDatesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const start = new Date(startDate + 'T12:00:00')
  const end = new Date(endDate + 'T12:00:00')

  const current = new Date(start)
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10))
    current.setDate(current.getDate() + 1)
  }

  return dates
}

export function WeekView({ plan }: WeekViewProps) {
  const today = getTodayString()
  const dates = getDatesInRange(plan.startDate, plan.endDate)

  // Group entries by date
  const entriesByDate = new Map<string, PlanEntry[]>()
  for (const date of dates) {
    entriesByDate.set(date, [])
  }
  for (const entry of plan.entries) {
    const existing = entriesByDate.get(entry.date)
    if (existing) {
      existing.push(entry)
    }
    // Silently skip entries with dates outside the plan range
  }

  return (
    <div className="flex flex-col gap-6">
      <Heading variant="h2">This week&apos;s meals</Heading>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
        {dates.map((date) => (
          <DayColumn
            key={date}
            date={date}
            planId={plan.id}
            entries={entriesByDate.get(date) ?? []}
            isToday={date === today}
          />
        ))}
      </div>
    </div>
  )
}
