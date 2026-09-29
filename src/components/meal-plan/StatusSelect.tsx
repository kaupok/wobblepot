'use client'

import { Check, ClipboardList, SkipForward, type LucideIcon } from 'lucide-react'
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

const STATUS_ICON: Record<MealStatus, LucideIcon> = {
  planned: ClipboardList,
  completed: Check,
  skipped: SkipForward,
}

const STATUS_VALUES: MealStatus[] = ['planned', 'completed', 'skipped']

interface StatusSelectProps {
  value: MealStatus
  onChange: (value: MealStatus) => void
  disabled?: boolean
}

// The tint is on our own content rather than on `SelectTrigger` / `SelectItem`:
// those own their colour (`shadcn/no-restyle`), and `SelectValue` renders this
// same node in the trigger, so one tint covers both places.
function StatusOption({ status }: { status: MealStatus }) {
  const label = useEnumLabel('MealPlanEntryStatus', status)
  const Icon = STATUS_ICON[status]
  return (
    <span
      className={cn(
        'flex items-center gap-2',
        status === 'planned' && 'text-muted-foreground',
        status === 'completed' && 'text-success',
        status === 'skipped' && 'text-warning',
      )}
    >
      {/* `text-current`: the trigger and item paint any svg without a `text-*`
          class muted, which would drop the status tint from the icon. */}
      <Icon className="size-4 text-current" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

export function StatusSelect({ value, onChange, disabled }: StatusSelectProps) {
  const tStatus = useTranslations('meal-plan.status')

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger size="sm" aria-label={tStatus('ariaLabel')} className="w-35">
        <SelectValue>
          <StatusOption status={value} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {STATUS_VALUES.map((status) => (
          <SelectItem key={status} value={status}>
            <StatusOption status={status} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
