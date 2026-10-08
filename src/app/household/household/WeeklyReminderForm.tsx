'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Body } from '@/components/ui/typography'
import { formatDayLong } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import {
  DEFAULT_REMINDER_WEEKDAY,
  REMINDER_WEEKDAYS,
  type ReminderWeekday,
} from '@/lib/weekly-reminder-schedule'
import { SettingsSection } from './SettingsSection'

type ReminderValues = { weekday: ReminderWeekday | null }

/** Whether the route says the confirm email did not go out (HON-1113). */
function confirmEmailNotSent(response: unknown): boolean {
  return (
    typeof response === 'object' &&
    response !== null &&
    (response as { confirmEmail?: unknown }).confirmEmail === 'not_sent'
  )
}

interface WeeklyReminderFormProps {
  /** The viewer's own reminder weekday, null when it is off. */
  weekday: ReminderWeekday | null
  /**
   * Whether the viewer opened the confirm link (HON-1113). Until then the
   * cron sends nothing, so the section says an email is waiting.
   */
  confirmed: boolean
  isOwner: boolean
}

/**
 * The weekday's name in the household language, from `Intl` rather than the
 * catalog. 1 January 2024 was a Monday, so day `n` of that month is ISO
 * weekday `n`. Capitalised, because it stands alone as an option label.
 */
function weekdayName(weekday: ReminderWeekday, locale: Locale) {
  const name = formatDayLong(new Date(Date.UTC(2024, 0, weekday)), locale, { timeZone: 'UTC' })
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
}

/**
 * Weekly reminder (HON-1084): the viewer's own opt-in to one email on a
 * weekday, sent only when next week has no meals planned. The consent is the
 * viewer's, so every member with an account can save it, not only the owner.
 * Saves to `/api/households/me/members/me/reminder`, which emails a confirm
 * link on the first switch-on (HON-1113).
 */
export function WeeklyReminderForm({
  weekday: savedWeekday,
  confirmed,
  isOwner,
}: WeeklyReminderFormProps) {
  const tSettings = useTranslations('household.settings')
  const locale = useLocale() as Locale

  const [saved, setSaved] = useState<ReminderValues>({ weekday: savedWeekday })
  const [weekday, setWeekday] = useState<ReminderWeekday | null>(savedWeekday)
  // Set by the last save: the switch-on's confirm email was rate limited or failed.
  const [confirmNotSent, setConfirmNotSent] = useState(false)
  // The confirm email goes out on save, not on tick, so this follows the saved value.
  const awaitingConfirm = saved.weekday !== null && !confirmed
  const describedBy = ['reminder-helper', awaitingConfirm && 'reminder-awaiting-confirm']
    .filter(Boolean)
    .join(' ')

  const handleSaved = (values: ReminderValues, response: unknown) => {
    setSaved(values)
    setConfirmNotSent(confirmEmailNotSent(response))
  }

  return (
    <SettingsSection
      id="reminder"
      heading={tSettings('reminderHeading')}
      url="/api/households/me/members/me/reminder"
      isOwner={isOwner}
      ownerOnly={false}
      values={{ weekday }}
      saved={saved}
      onSaved={handleSaved}
    >
      {({ disabled, errorId }) => (
        <>
          {/* The page's owner-only notice covers the other sections, not this one. */}
          {!isOwner && <Body variant="muted">{tSettings('reminderOwnNotice')}</Body>}
          <div className="flex items-start gap-2">
            <Checkbox
              id="reminder-on"
              checked={weekday !== null}
              onCheckedChange={(checked) =>
                setWeekday(checked === true ? (saved.weekday ?? DEFAULT_REMINDER_WEEKDAY) : null)
              }
              disabled={disabled}
              aria-describedby={errorId ? `${describedBy} ${errorId}` : describedBy}
            />
            <Label htmlFor="reminder-on" className="font-normal">
              <span className="leading-snug">{tSettings('reminderToggle')}</span>
            </Label>
          </div>
          {weekday !== null && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="reminder-weekday">{tSettings('reminderWeekdayLabel')}</Label>
              <Select
                value={String(weekday)}
                onValueChange={(value) => setWeekday(Number(value) as ReminderWeekday)}
                disabled={disabled}
              >
                <SelectTrigger
                  id="reminder-weekday"
                  className="w-full"
                  aria-invalid={!!errorId}
                  aria-describedby={errorId}
                >
                  {/* Explicit children, so the server HTML carries the value
                      before Radix mounts the items (HON-761). */}
                  <SelectValue>{weekdayName(weekday, locale)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {REMINDER_WEEKDAYS.map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      {weekdayName(day, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Body id="reminder-helper" variant="muted">
            {tSettings('reminderHelper')}
          </Body>
          {awaitingConfirm && (
            <Body id="reminder-awaiting-confirm" variant="muted">
              {confirmNotSent
                ? tSettings('reminderConfirmNotSent')
                : tSettings('reminderAwaitingConfirm')}
            </Body>
          )}
        </>
      )}
    </SettingsSection>
  )
}
