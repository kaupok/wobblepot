'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type MealStatus = 'planned' | 'completed' | 'skipped'

interface StatusConfig {
  label: string
  icon: string
  className: string
}

const STATUS_CONFIG: Record<MealStatus, StatusConfig> = {
  planned: {
    label: 'Planned',
    icon: '\u{1F4CB}',
    className: 'text-muted-foreground',
  },
  completed: {
    label: 'Completed',
    icon: '\u2713',
    className: 'text-green-700 dark:text-green-400',
  },
  skipped: {
    label: 'Skipped',
    icon: '\u23ED\uFE0F',
    className: 'text-yellow-700 dark:text-yellow-400',
  },
}

interface StatusSelectProps {
  value: MealStatus
  onChange: (value: MealStatus) => void
  disabled?: boolean
}

export function StatusSelect({ value, onChange, disabled }: StatusSelectProps) {
  const config = STATUS_CONFIG[value]

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        size="sm"
        aria-label="Meal status"
        className={cn('w-[140px]', config.className)}
      >
        <SelectValue>
          <span className="flex items-center gap-2">
            <span>{config.icon}</span>
            <span>{config.label}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(STATUS_CONFIG) as [MealStatus, StatusConfig][]).map(([status, cfg]) => (
          <SelectItem key={status} value={status} className={cfg.className}>
            <span className="flex items-center gap-2">
              <span>{cfg.icon}</span>
              <span>{cfg.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
