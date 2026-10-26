'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Label } from '@/components/ui/label'
import { Body } from '@/components/ui/typography'
import { ChoiceChips } from '@/components/ui/choice-chips'
import { TagInput, type TagInputRef } from '@/components/tag-input'
import { AllergenPicker } from '@/components/household/AllergenPicker'
import { SettingsSection } from '@/components/SettingsSection'
import { ExcludedMatches } from './ExcludedMatches'
import type {
  Allergen,
  DietaryType,
  ExcludedMatch,
  HouseholdPreferencesValues,
} from './preference-values'

const DIETARY_TYPE_VALUES: readonly DietaryType[] = ['vegetarian', 'vegan', 'pescatarian']

type FoodValues = Pick<
  HouseholdPreferencesValues,
  'dietaryType' | 'allergensToAvoid' | 'restrictions' | 'excludedIngredients'
>

/** The preferences route's `conflictingEntries`, or 0 when it is absent. */
function conflictingEntries(response: unknown): number {
  if (typeof response !== 'object' || response === null) return 0
  const count = (response as { conflictingEntries?: unknown }).conflictingEntries
  return typeof count === 'number' && count > 0 ? count : 0
}

/** The preferences route's `excludedMatches`, or null when it is absent. */
function excludedMatchesOf(response: unknown): ExcludedMatch[] | null {
  if (typeof response !== 'object' || response === null) return null
  const matches = (response as { excludedMatches?: unknown }).excludedMatches
  return Array.isArray(matches) ? (matches as ExcludedMatch[]) : null
}

interface FoodPreferencesFormProps {
  preferences: HouseholdPreferencesValues | null
  /** What each saved "Ingredients to avoid" tag excludes (HON-1321). */
  excludedMatches: ExcludedMatch[]
  isOwner: boolean
}

/**
 * Food preferences: dietary type, allergens, restrictions, ingredients to
 * avoid. Saves those four fields to `/api/households/me/preferences`, whose
 * schema makes every field optional, so the meal types are left alone.
 */
export function FoodPreferencesForm({
  preferences,
  excludedMatches: initialMatches,
  isOwner,
}: FoodPreferencesFormProps) {
  const t = useTranslations('household')
  const tSettings = useTranslations('household.settings')
  const tDietary = useTranslations('enums.DietaryType')

  const [saved, setSaved] = useState<FoodValues>({
    dietaryType: preferences?.dietaryType ?? null,
    allergensToAvoid: preferences?.allergensToAvoid ?? [],
    restrictions: preferences?.restrictions ?? [],
    excludedIngredients: preferences?.excludedIngredients ?? [],
  })
  const [dietaryType, setDietaryType] = useState<DietaryType | null>(saved.dietaryType)
  const [allergensToAvoid, setAllergensToAvoid] = useState<Allergen[]>(saved.allergensToAvoid)
  const [restrictions, setRestrictions] = useState<string[]>(saved.restrictions)
  const [excludedIngredients, setExcludedIngredients] = useState<string[]>(
    saved.excludedIngredients,
  )
  const [excludedMatches, setExcludedMatches] = useState<ExcludedMatch[]>(initialMatches)

  // The route counts the planned meals the saved preferences conflict with
  // (HON-1126). None, or a response without the count, keeps "Settings saved".
  const savedMessage = (response: unknown) => {
    const count = conflictingEntries(response)
    return count ? tSettings('savedWithConflicts', { count }) : undefined
  }

  const restrictionsRef = useRef<TagInputRef>(null)
  const excludedIngredientsRef = useRef<TagInputRef>(null)

  const values: FoodValues = { dietaryType, allergensToAvoid, restrictions, excludedIngredients }

  // Text typed into a tag input but not yet turned into a tag is still sent.
  const collectValues = (): FoodValues => ({
    ...values,
    restrictions: restrictionsRef.current?.commitPendingValue() ?? restrictions,
    excludedIngredients:
      excludedIngredientsRef.current?.commitPendingValue() ?? excludedIngredients,
  })

  return (
    <SettingsSection
      id="food"
      heading={tSettings('foodHeading')}
      url="/api/households/me/preferences"
      isOwner={isOwner}
      values={values}
      saved={saved}
      collectValues={collectValues}
      onSaved={(values, response) => {
        setSaved(values)
        const matches = excludedMatchesOf(response)
        if (matches) setExcludedMatches(matches)
      }}
      savedMessage={savedMessage}
    >
      {({ disabled, errorId }) => (
        <>
          <div className="flex flex-col gap-2">
            <Label id="dietary-type-label">{tSettings('dietaryTypeLabel')}</Label>
            <ChoiceChips
              aria-labelledby="dietary-type-label"
              aria-describedby={errorId}
              value={dietaryType ?? 'none'}
              onValueChange={(value) =>
                setDietaryType(value === 'none' ? null : (value as DietaryType))
              }
              options={[
                { value: 'none', label: t('dietaryNone') },
                ...DIETARY_TYPE_VALUES.map((value) => ({ value, label: tDietary(value) })),
              ]}
              disabled={disabled}
            />
          </div>
          <AllergenPicker
            value={allergensToAvoid}
            onChange={setAllergensToAvoid}
            disabled={disabled}
            errorId={errorId}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="restrictions">{tSettings('restrictionsLabel')}</Label>
            <TagInput
              ref={restrictionsRef}
              id="restrictions"
              value={restrictions}
              onChange={setRestrictions}
              placeholder={tSettings('restrictionsPlaceholder')}
              disabled={disabled}
              aria-describedby="restrictions-help"
            />
            <Body id="restrictions-help" variant="muted">
              {tSettings('restrictionsHelp')}
            </Body>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="excluded">{tSettings('excludedLabel')}</Label>
            <TagInput
              ref={excludedIngredientsRef}
              id="excluded"
              value={excludedIngredients}
              onChange={setExcludedIngredients}
              placeholder={tSettings('excludedPlaceholder')}
              disabled={disabled}
            />
            <ExcludedMatches tags={excludedIngredients} matches={excludedMatches} />
          </div>
        </>
      )}
    </SettingsSection>
  )
}
