import Link from 'next/link'
import { cn } from '@/lib/utils'

interface WeekTabsProps {
  activeWeek: 'last' | 'current' | 'next'
  currentWeekDays: number
  hasLastPlan: boolean
  hasCurrentPlan: boolean
  hasNextPlan: boolean
}

export function WeekTabs({
  activeWeek,
  currentWeekDays,
  hasLastPlan,
  hasCurrentPlan,
  hasNextPlan,
}: WeekTabsProps) {
  // On Sunday (0 days remaining), only show "Next week" tab
  const showCurrentTab = currentWeekDays > 0

  const tabClasses = (isActive: boolean) =>
    cn(
      'border-b-2 px-1 py-3 text-sm font-medium transition-colors',
      isActive
        ? 'border-primary text-primary'
        : 'text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground border-transparent',
    )

  return (
    <div className="border-border border-b">
      <nav className="-mb-px flex gap-4" aria-label="Week navigation">
        {hasLastPlan && (
          <Link
            href="/dashboard?week=last"
            className={tabClasses(activeWeek === 'last')}
            aria-current={activeWeek === 'last' ? 'page' : undefined}
          >
            Last week
          </Link>
        )}
        {showCurrentTab && (
          <Link
            href="/dashboard?week=current"
            className={tabClasses(activeWeek === 'current')}
            aria-current={activeWeek === 'current' ? 'page' : undefined}
          >
            This week
            {currentWeekDays < 7 && (
              <span className="text-muted-foreground ml-1.5 text-xs">
                ({currentWeekDays} {currentWeekDays === 1 ? 'day' : 'days'})
              </span>
            )}
            {!hasCurrentPlan && (
              <span className="bg-muted ml-1.5 rounded-full px-1.5 py-0.5 text-xs">No plan</span>
            )}
          </Link>
        )}
        <Link
          href="/dashboard?week=next"
          className={tabClasses(activeWeek === 'next')}
          aria-current={activeWeek === 'next' ? 'page' : undefined}
        >
          Next week
          {!hasNextPlan && (
            <span className="bg-muted ml-1.5 rounded-full px-1.5 py-0.5 text-xs">No plan</span>
          )}
        </Link>
      </nav>
    </div>
  )
}
