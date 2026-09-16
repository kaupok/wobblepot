'use client'

import { useTranslations } from 'next-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { cn } from '@/lib/utils'

export type MealStatus = 'planned' | 'completed' | 'skipped'

const STATUS_ICON: Record<MealStatus, string> = {
  planned: '\u{1F4CB}',
  completed: '\u2713',
  skipped: '\u23ED\uFE0F',
}

const STATUS_VALUES: MealStatus[] = ['planned', 'completed', 'skipped']

interface StatusSelectProps {
  value: MealStatus
  onChange: (value: MealStatus) => void
  disabled?: boolean
}

function StatusOption({ status }: { status: MealStatus }) {
  const label = useEnumLabel('MealPlanEntryStatus', status)
  return (
    <span className="flex items-center gap-2">
      <span>{STATUS_ICON[status]}</span>
      <span>{label}</span>
    </span>
  )
}

export function StatusSelect({ value, onChange, disabled }: StatusSelectProps) {
  const tStatus = useTranslations('meal-plan.status')

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        size="sm"
        aria-label={tStatus('ariaLabel')}
        className={cn(
          'w-35',
          value === 'planned' && 'text-muted-foreground',
          value === 'completed' && 'text-success',
          value === 'skipped' && 'text-warning',
        )}
      >
        <SelectValue>
          <StatusOption status={value} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {STATUS_VALUES.map((status) => (
          <SelectItem
            key={status}
            value={status}
            className={cn(
              status === 'planned' && 'text-muted-foreground',
              status === 'completed' && 'text-success',
              status === 'skipped' && 'text-warning',
            )}
          >
            <StatusOption status={status} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
