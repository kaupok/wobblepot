'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type MealStatus = 'planned' | 'completed' | 'skipped' | 'eating_out' | 'leftovers'

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
    className: 'text-green-600 dark:text-green-400',
  },
  skipped: {
    label: 'Skipped',
    icon: '\u23ED\uFE0F',
    className: 'text-yellow-600 dark:text-yellow-400',
  },
  eating_out: {
    label: 'Eating out',
    icon: '\u{1F37D}\uFE0F',
    className: 'text-blue-600 dark:text-blue-400',
  },
  leftovers: {
    label: 'Leftovers',
    icon: '\u{1F371}',
    className: 'text-purple-600 dark:text-purple-400',
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
      <SelectTrigger size="sm" className={cn('w-[140px]', config.className)}>
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
