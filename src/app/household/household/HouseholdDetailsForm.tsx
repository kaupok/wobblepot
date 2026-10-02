'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Body } from '@/components/ui/typography'
import { PUBLIC_LOCALES, type Locale } from '@/lib/i18n/locales'
import { SettingsSection } from './SettingsSection'
import type { HouseholdDetails } from './settings-values'

// Get all IANA timezones
const TIMEZONES = Intl.supportedValuesOf('timeZone')

function timezoneLabel(tz: string) {
  return tz.replace(/_/g, ' ')
}

type DetailsValues = { name: string; timezone: string; locale: Locale }

interface HouseholdDetailsFormProps {
  household: HouseholdDetails
  isOwner: boolean
}

/** Household details: name, timezone, language. Saves to `/api/households/me`. */
export function HouseholdDetailsForm({ household, isOwner }: HouseholdDetailsFormProps) {
  const t = useTranslations('household')
  const tSettings = useTranslations('household.settings')
  const queryClient = useQueryClient()

  const [saved, setSaved] = useState<DetailsValues>({
    name: household.name,
    timezone: household.timezone,
    locale: household.locale,
  })
  const [name, setName] = useState(household.name)
  const [timezone, setTimezone] = useState(household.timezone)
  const [locale, setLocale] = useState<Locale>(household.locale)

  const handleSaved = (sent: DetailsValues) => {
    // A locale change reaches every entity's names (recipes, the meal
    // selector, `/api/meals`, tips), and query results already in the browser
    // would keep the old language until `staleTime` expires. The locale
    // touches the whole cache, so invalidate all of it (HON-921). The section
    // then refreshes the server tree, which carries `<html lang>` and the
    // NextIntlClientProvider messages.
    if (sent.locale !== saved.locale) {
      void queryClient.invalidateQueries()
    }
    setSaved(sent)
  }

  return (
    <SettingsSection
      id="details"
      heading={tSettings('detailsHeading')}
      url="/api/households/me"
      isOwner={isOwner}
      values={{ name, timezone, locale }}
      saved={saved}
      onSaved={handleSaved}
    >
      {({ disabled, errorId }) => (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">{tSettings('nameLabel')}</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
              disabled={disabled}
              aria-invalid={!!errorId}
              aria-describedby={errorId}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="timezone">{tSettings('timezoneLabel')}</Label>
            <Select value={timezone} onValueChange={setTimezone} disabled={disabled}>
              <SelectTrigger
                id="timezone"
                className="w-full"
                aria-invalid={!!errorId}
                aria-describedby={errorId}
              >
                {/* Explicit children: without them Radix mirrors the selected
                    item's text only after mount, so the server HTML shows an
                    empty trigger until hydration (HON-761). An empty value
                    still falls back to the placeholder. */}
                <SelectValue placeholder={tSettings('timezonePlaceholder')}>
                  {timezoneLabel(timezone)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {timezoneLabel(tz)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="locale">{t('localeLabel')}</Label>
            <Select
              value={locale}
              onValueChange={(value) => setLocale(value as Locale)}
              disabled={disabled}
            >
              <SelectTrigger
                id="locale"
                className="w-full"
                aria-invalid={!!errorId}
                aria-describedby={errorId ? `locale-helper ${errorId}` : 'locale-helper'}
              >
                <SelectValue>{t(`localeOption.${locale}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PUBLIC_LOCALES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {t(`localeOption.${code}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Body id="locale-helper" variant="muted">
              {t('localeHelperText')}
            </Body>
          </div>
        </>
      )}
    </SettingsSection>
  )
}
