'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Label } from '@/components/ui/label'
import { ChoiceChips } from '@/components/ui/choice-chips'
import { Toggle } from '@/components/ui/toggle'
import { Body } from '@/components/ui/typography'
import { TagInput, type TagInputRef } from '@/components/tag-input'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { SettingsSection } from './SettingsSection'
import type { Allergen, DietaryType, HouseholdPreferencesValues } from './settings-values'

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

function AllergenToggle({
  value,
  pressed,
  disabled,
  onPressedChange,
}: {
  value: Allergen
  pressed: boolean
  disabled: boolean
  onPressedChange: (pressed: boolean) => void
}) {
  const label = useEnumLabel('Allergen', value)
  return (
    <Toggle
      variant="outline"
      tone="primary"
      size="chip"
      indicator
      pressed={pressed}
      onPressedChange={onPressedChange}
      disabled={disabled}
    >
      {label}
    </Toggle>
  )
}

type FoodValues = Pick<
  HouseholdPreferencesValues,
  'dietaryType' | 'allergensToAvoid' | 'restrictions' | 'excludedIngredients'
>

interface FoodPreferencesFormProps {
  preferences: HouseholdPreferencesValues | null
  isOwner: boolean
}

/**
 * Food preferences: dietary type, allergens, restrictions, ingredients to
 * avoid. Saves those four fields to `/api/households/me/preferences`, whose
 * schema makes every field optional, so the meal types are left alone.
 */
export function FoodPreferencesForm({ preferences, isOwner }: FoodPreferencesFormProps) {
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

  const handleAllergenToggle = (allergen: Allergen, pressed: boolean) => {
    setAllergensToAvoid((current) =>
      pressed ? [...current, allergen] : current.filter((a) => a !== allergen),
    )
  }

  return (
    <SettingsSection
      id="food"
      heading={tSettings('foodHeading')}
      url="/api/households/me/preferences"
      isOwner={isOwner}
      values={values}
      saved={saved}
      collectValues={collectValues}
      onSaved={setSaved}
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
          <div className="flex flex-col gap-2">
            <Label id="allergens-label">{tSettings('allergensLabel')}</Label>
            <div
              role="group"
              aria-labelledby="allergens-label"
              aria-describedby={errorId ? `allergens-ai-notice ${errorId}` : 'allergens-ai-notice'}
              className="flex flex-wrap gap-2"
            >
              {ALLERGEN_VALUES.map((allergen) => (
                <AllergenToggle
                  key={allergen}
                  value={allergen}
                  pressed={allergensToAvoid.includes(allergen)}
                  disabled={disabled}
                  onPressedChange={(pressed) => handleAllergenToggle(allergen, pressed)}
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
              disabled={disabled}
            />
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
          </div>
        </>
      )}
    </SettingsSection>
  )
}
