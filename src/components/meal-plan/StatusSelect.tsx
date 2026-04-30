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

const STATUS_CONFIG: Record<MealStatus, { icon: string; className: string }> = {
  planned: {
    icon: '\u{1F4CB}',
    className: 'text-muted-foreground',
  },
  completed: {
    icon: '\u2713',
    className: 'text-green-700 dark:text-green-400',
  },
  skipped: {
    icon: '\u23ED\uFE0F',
    className: 'text-yellow-700 dark:text-yellow-400',
  },
}

const STATUS_VALUES: MealStatus[] = ['planned', 'completed', 'skipped']

interface StatusSelectProps {
  value: MealStatus
  onChange: (value: MealStatus) => void
  disabled?: boolean
}

function StatusOption({ status }: { status: MealStatus }) {
  const cfg = STATUS_CONFIG[status]
  const label = useEnumLabel('MealPlanEntryStatus', status)
  return (
    <span className="flex items-center gap-2">
      <span>{cfg.icon}</span>
      <span>{label}</span>
    </span>
  )
}

export function StatusSelect({ value, onChange, disabled }: StatusSelectProps) {
  const tStatus = useTranslations('meal-plan.status')
  const config = STATUS_CONFIG[value]

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        size="sm"
        aria-label={tStatus('ariaLabel')}
        className={cn('w-[140px]', config.className)}
      >
        <SelectValue>
          <StatusOption status={value} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {STATUS_VALUES.map((status) => (
          <SelectItem key={status} value={status} className={STATUS_CONFIG[status].className}>
            <StatusOption status={status} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
