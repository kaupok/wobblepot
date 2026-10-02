'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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

  const handleAllergenToggle = (allergen: Allergen, checked: boolean) => {
    setAllergensToAvoid((current) =>
      checked ? [...current, allergen] : current.filter((a) => a !== allergen),
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
            <RadioGroup
              value={dietaryType ?? 'none'}
              onValueChange={(value) =>
                setDietaryType(value === 'none' ? null : (value as DietaryType))
              }
              disabled={disabled}
              aria-labelledby="dietary-type-label"
              aria-describedby={errorId}
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
              aria-describedby={errorId ? `allergens-ai-notice ${errorId}` : 'allergens-ai-notice'}
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {ALLERGEN_VALUES.map((allergen) => (
                <AllergenCheckbox
                  key={allergen}
                  value={allergen}
                  checked={allergensToAvoid.includes(allergen)}
                  disabled={disabled}
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
