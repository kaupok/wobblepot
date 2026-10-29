'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { SettingsSection } from '@/components/SettingsSection'
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

type ReminderValues = { weekday: ReminderWeekday | null }

/**
 * What the route says about the confirm email (HON-1113): `'sent'` or
 * `'not_sent'` on a switch-on, undefined on any other save.
 */
function confirmEmailOutcome(response: unknown): unknown {
  return typeof response === 'object' && response !== null
    ? (response as { confirmEmail?: unknown }).confirmEmail
    : undefined
}

interface WeeklyReminderFormProps {
  /** The viewer's own reminder weekday, null when it is off. */
  weekday: ReminderWeekday | null
  /**
   * Whether the viewer opened the confirm link (HON-1113). Until then the
   * cron sends nothing, so the section says an email is waiting.
   */
  confirmed: boolean
  /**
   * Whether a confirm link is out for the address. False only after an
   * account email change (HON-1137), which drops the link without sending a
   * new one: the member switches the reminder off and on to get one.
   */
  confirmLinkSent?: boolean
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
 * viewer's, so it lives on My account → Reminders (HON-1256), and every
 * account holder can save it, not only the owner. Saves to
 * `/api/households/me/members/me/reminder`, which emails a confirm link on
 * the first switch-on (HON-1113).
 */
export function WeeklyReminderForm({
  weekday: savedWeekday,
  confirmed,
  confirmLinkSent = true,
}: WeeklyReminderFormProps) {
  const tSettings = useTranslations('household.settings')
  const locale = useLocale() as Locale

  const [saved, setSaved] = useState<ReminderValues>({ weekday: savedWeekday })
  const [weekday, setWeekday] = useState<ReminderWeekday | null>(savedWeekday)
  // Set by the last save: the switch-on's confirm email was rate limited or failed.
  const [confirmNotSent, setConfirmNotSent] = useState(false)
  // A switch-on that reports an outcome tried to send a link, so the email-change state ends.
  const [linkSent, setLinkSent] = useState(confirmLinkSent)
  // The confirm email goes out on save, not on tick, so this follows the saved value.
  const awaitingConfirm = saved.weekday !== null && !confirmed
  const describedBy = ['reminder-helper', awaitingConfirm && 'reminder-awaiting-confirm']
    .filter(Boolean)
    .join(' ')

  // Only a save that reports an outcome, or a switch-off, changes the flag: a
  // day change sends nothing, so it must not turn "not sent" into "emailed".
  const handleSaved = (values: ReminderValues, response: unknown) => {
    setSaved(values)
    const outcome = confirmEmailOutcome(response)
    if (values.weekday === null) setConfirmNotSent(false)
    else if (outcome !== undefined) {
      setConfirmNotSent(outcome === 'not_sent')
      setLinkSent(true)
    }
  }

  return (
    <SettingsSection
      id="reminder"
      heading={tSettings('reminderHeading')}
      url="/api/households/me/members/me/reminder"
      ownerOnly={false}
      values={{ weekday }}
      saved={saved}
      onSaved={handleSaved}
    >
      {({ disabled, errorId }) => (
        <>
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
                : linkSent
                  ? tSettings('reminderAwaitingConfirm')
                  : tSettings('reminderConfirmAfterEmailChange')}
            </Body>
          )}
        </>
      )}
    </SettingsSection>
  )
}
