'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Heading, Body } from '@/components/ui/typography'
import { TagInput, type TagInputRef } from '@/components/tag-input'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { PUBLIC_LOCALES, type Locale } from '@/lib/i18n/locales'
import { MEAL_TYPE_VALUES } from '@/components/household/meal-form-types'
import { FieldError } from '@/components/FieldError'

// Types matching Prisma enums
type DietaryType = 'vegetarian' | 'vegan' | 'pescatarian'
type Allergen =
  'gluten' | 'dairy' | 'eggs' | 'nuts' | 'peanuts' | 'soy' | 'fish' | 'shellfish' | 'sesame'
type MealType = 'breakfast' | 'lunch' | 'dinner'

const DIETARY_TYPE_VALUES: readonly DietaryType[] = ['vegetarian', 'vegan', 'pescatarian']
const ALLERGEN_VALUES: readonly Allergen[] = [
  'gluten',
  'dairy',
  'eggs',
  'nuts',
  'peanuts',
  'soy',
  'fish',
  'shellfish',
  'sesame',
]
function DietaryTypeRadio({ value }: { value: DietaryType }) {
  const label = useEnumLabel('DietaryType', value)
  const id = `dietary-${value}`
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem value={value} id={id} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  )
}

function AllergenCheckbox({
  value,
  checked,
  disabled,
  onCheckedChange,
}: {
  value: Allergen
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const label = useEnumLabel('Allergen', value)
  const id = `allergen-${value}`
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  )
}

function MealTypeCheckbox({
  mealType,
  idPrefix,
  checked,
  disabled,
  onCheckedChange,
}: {
  mealType: MealType
  idPrefix: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const id = `${idPrefix}-${mealType}`
  const label = useEnumLabel('MealType', mealType)
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  )
}

// Get all IANA timezones
const TIMEZONES = Intl.supportedValuesOf('timeZone')

function timezoneLabel(tz: string) {
  return tz.replace(/_/g, ' ')
}

interface HouseholdSettingsFormProps {
  household: {
    id: string
    name: string
    timezone: string
    locale: Locale
  }
  preferences: {
    dietaryType: DietaryType | null
    allergensToAvoid: Allergen[]
    restrictions: string[]
    excludedIngredients: string[]
    weekdayMealTypes: MealType[]
    weekendMealTypes: MealType[]
  } | null
  isOwner: boolean
}

export function HouseholdSettingsForm({
  household,
  preferences,
  isOwner,
}: HouseholdSettingsFormProps) {
  const t = useTranslations('household')
  const tSettings = useTranslations('household.settings')
  const router = useRouter()

  // Basic info state
  const [name, setName] = useState(household.name)
  const [timezone, setTimezone] = useState(household.timezone)
  const [locale, setLocale] = useState<Locale>(household.locale)

  // Preferences state
  const [dietaryType, setDietaryType] = useState<DietaryType | 'none'>(
    preferences?.dietaryType ?? 'none',
  )
  const [allergensToAvoid, setAllergensToAvoid] = useState<Allergen[]>(
    preferences?.allergensToAvoid ?? [],
  )
  const [restrictions, setRestrictions] = useState<string[]>(preferences?.restrictions ?? [])
  const [excludedIngredients, setExcludedIngredients] = useState<string[]>(
    preferences?.excludedIngredients ?? [],
  )
  const [weekdayMealTypes, setWeekdayMealTypes] = useState<MealType[]>(
    preferences?.weekdayMealTypes ?? ['dinner'],
  )
  const [weekendMealTypes, setWeekendMealTypes] = useState<MealType[]>(
    preferences?.weekendMealTypes ?? ['dinner'],
  )

  // Refs for tag inputs
  const restrictionsRef = useRef<TagInputRef>(null)
  const excludedIngredientsRef = useRef<TagInputRef>(null)

  // Form state
  const [error, setError] = useState('')

  const saveSettings = useMutation({
    mutationFn: async () => {
      // Both endpoints are owner-only (they 403 a member), so a non-owner has
      // nothing to save. handleSubmit and the hidden save button stop them
      // first; this keeps the mutation from relying on either (HON-677).
      // Throw rather than return, so it can never read as a successful save.
      if (!isOwner) throw new Error(tSettings('ownerOnlyNotice'))

      const preferencesPayload = {
        dietaryType: dietaryType === 'none' ? null : dietaryType,
        allergensToAvoid,
        restrictions,
        excludedIngredients,
        weekdayMealTypes,
        weekendMealTypes,
      }

      const responses = await Promise.all([
        fetch('/api/households/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, timezone, locale }),
        }),
        fetch('/api/households/me/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(preferencesPayload),
        }),
      ])

      for (const response of responses) {
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || tSettings('saveFailed'))
        }
      }
    },
    onSuccess: () => {
      toast.success(tSettings('savedToast'))
      // Re-render the server tree so NextIntlClientProvider / `<html lang>` /
      // server-rendered header pick up a changed household.locale without a
      // manual reload. (Not TanStack cache invalidation — this is SSR content
      // tied to the DB row.)
      router.refresh()
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : tSettings('errorGeneric'))
    },
  })

  const isLoading = saveSettings.isPending
  const controlsDisabled = isLoading || !isOwner

  const handleAllergenToggle = (allergen: Allergen, checked: boolean) => {
    if (checked) {
      setAllergensToAvoid([...allergensToAvoid, allergen])
    } else {
      setAllergensToAvoid(allergensToAvoid.filter((a) => a !== allergen))
    }
  }

  const handleMealTypeToggle = (mealType: MealType, checked: boolean, isWeekend: boolean) => {
    const setter = isWeekend ? setWeekendMealTypes : setWeekdayMealTypes
    const current = isWeekend ? weekendMealTypes : weekdayMealTypes

    if (checked) {
      setter([...current, mealType])
    } else {
      setter(current.filter((m) => m !== mealType))
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isOwner) return

    // Commit any pending tag input values before submitting
    restrictionsRef.current?.commitPendingValue()
    excludedIngredientsRef.current?.commitPendingValue()

    setError('')
    saveSettings.mutate()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Heading variant="h4" as="h2">
          {tSettings('heading')}
        </Heading>
        <Body variant="muted">{tSettings('description')}</Body>
        {!isOwner && <Body variant="muted">{tSettings('ownerOnlyNotice')}</Body>}
      </div>
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-8">
          {/* Section 1: Basic Info */}
          <section className="flex flex-col gap-4">
            <Heading variant="section" as="h3">
              {tSettings('basicHeading')}
            </Heading>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{tSettings('nameLabel')}</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
                disabled={controlsDisabled}
                aria-invalid={!!error}
                aria-describedby={error ? 'form-error' : undefined}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="timezone">{tSettings('timezoneLabel')}</Label>
              <Select value={timezone} onValueChange={setTimezone} disabled={controlsDisabled}>
                <SelectTrigger
                  id="timezone"
                  className="w-full"
                  aria-invalid={!!error}
                  aria-describedby={error ? 'form-error' : undefined}
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
                disabled={controlsDisabled}
              >
                <SelectTrigger id="locale" className="w-full">
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
              <Body variant="muted">{t('localeHelperText')}</Body>
            </div>
          </section>

          {/* Section 2: Dietary Preferences */}
          <section className="flex flex-col gap-4">
            <Heading variant="section" as="h3">
              {tSettings('preferencesHeading')}
            </Heading>
            <div className="flex flex-col gap-2">
              <Label>{tSettings('dietaryTypeLabel')}</Label>
              <RadioGroup
                value={dietaryType}
                onValueChange={(value) => setDietaryType(value as DietaryType | 'none')}
                disabled={controlsDisabled}
                className="flex flex-wrap"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="none" id="dietary-none" />
                  <Label htmlFor="dietary-none" className="font-normal">
                    {t('dietaryNone')}
                  </Label>
                </div>
                {DIETARY_TYPE_VALUES.map((value) => (
                  <DietaryTypeRadio key={value} value={value} />
                ))}
              </RadioGroup>
            </div>
            <div className="flex flex-col gap-2">
              <Label id="allergens-label">{tSettings('allergensLabel')}</Label>
              <div
                role="group"
                aria-labelledby="allergens-label"
                aria-describedby="allergens-ai-notice"
                className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              >
                {ALLERGEN_VALUES.map((allergen) => (
                  <AllergenCheckbox
                    key={allergen}
                    value={allergen}
                    checked={allergensToAvoid.includes(allergen)}
                    disabled={controlsDisabled}
                    onCheckedChange={(checked) => handleAllergenToggle(allergen, checked)}
                  />
                ))}
              </div>
              {/* The DPIA's point-of-entry affirmation for Art. 9 allergen data
                  (compliance/dpia.md → Risk area 2, HON-666). */}
              <Body id="allergens-ai-notice" variant="muted">
                {tSettings.rich('allergensAiNotice', {
                  privacy: (chunks) => (
                    <Link
                      href="/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </Body>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="restrictions">{tSettings('restrictionsLabel')}</Label>
              <TagInput
                ref={restrictionsRef}
                id="restrictions"
                value={restrictions}
                onChange={setRestrictions}
                placeholder={tSettings('restrictionsPlaceholder')}
                disabled={controlsDisabled}
              />
              <Body variant="muted">{tSettings('restrictionsHelper')}</Body>
            </div>
          </section>

          {/* Section 3: Excluded Ingredients */}
          <section className="flex flex-col gap-4">
            <Heading variant="section" as="h3">
              {tSettings('excludedHeading')}
            </Heading>
            <div className="flex flex-col gap-2">
              <Label htmlFor="excluded">{tSettings('excludedLabel')}</Label>
              <TagInput
                ref={excludedIngredientsRef}
                id="excluded"
                value={excludedIngredients}
                onChange={setExcludedIngredients}
                placeholder={tSettings('excludedPlaceholder')}
                disabled={controlsDisabled}
              />
              <Body variant="muted">{tSettings('excludedHelper')}</Body>
            </div>
          </section>

          {/* Section 4: Meal Scheduling */}
          <section className="flex flex-col gap-4">
            <Heading variant="section" as="h3">
              {tSettings('mealSchedulingHeading')}
            </Heading>
            <div className="flex flex-col gap-2">
              <Label>{tSettings('weekdayMealsLabel')}</Label>
              <div className="flex gap-4">
                {MEAL_TYPE_VALUES.map((mealType) => (
                  <MealTypeCheckbox
                    key={mealType}
                    mealType={mealType}
                    idPrefix="weekday"
                    checked={weekdayMealTypes.includes(mealType)}
                    disabled={controlsDisabled}
                    onCheckedChange={(checked) => handleMealTypeToggle(mealType, checked, false)}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>{tSettings('weekendMealsLabel')}</Label>
              <div className="flex gap-4">
                {MEAL_TYPE_VALUES.map((mealType) => (
                  <MealTypeCheckbox
                    key={mealType}
                    mealType={mealType}
                    idPrefix="weekend"
                    checked={weekendMealTypes.includes(mealType)}
                    disabled={controlsDisabled}
                    onCheckedChange={(checked) => handleMealTypeToggle(mealType, checked, true)}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* Submit */}
          <div className="flex flex-col gap-4 pt-2">
            {error && <FieldError id="form-error">{error}</FieldError>}
            {isOwner && (
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? tSettings('saving') : tSettings('saveButton')}
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
