'use client'

import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChoiceChips } from '@/components/ui/choice-chips'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { FieldError } from '@/components/FieldError'
import { ALLERGEN_VALUES } from '@/components/household/AllergenPicker'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import type { HouseholdIngredient } from '@/lib/ingredients/household-ingredient'
import {
  defaultProteinType,
  GRAMS_PER_PIECE_MAX,
  INGREDIENT_CATEGORIES,
  isProteinTypedCategory,
  NEW_INGREDIENT_NAME_MAX,
  NUTRITION_MAX,
  PROTEIN_TYPES_BY_CATEGORY,
  type NewIngredientInput,
  type NutritionField,
} from '@/lib/ingredients/new-ingredient'
import type { Allergen, IngredientCategory, ProteinType, Unit } from '@/generated/prisma/enums'

/**
 * The fields of a household ingredient: name, category, protein type, unit,
 * allergens and the pack label per 100 g. "Add as new ingredient" (HON-1263)
 * and the Ingredients tab's Edit (HON-1264) both render them, so the two
 * cannot drift. The caller owns the heading, the buttons and the request.
 */

/** A field that can carry an error; the keys match the route's validation `details`. */
type Field = 'name' | 'category' | 'proteinType' | 'gramsPerPiece' | NutritionField

const NUTRITION_FIELDS: readonly NutritionField[] = ['calories', 'protein', 'carbs', 'fat', 'fiber']
const FIELDS: readonly Field[] = [
  'name',
  'category',
  'proteinType',
  'gramsPerPiece',
  ...NUTRITION_FIELDS,
]

/** What the fields start from: a recipe's name alone, or a saved row. */
export type IngredientDraftInitial = Pick<HouseholdIngredient, 'name'> &
  Partial<Omit<HouseholdIngredient, 'id' | 'name'>>

/** The fields' state, their checks and the server's field errors. Pass it to `IngredientFields`. */
export function useIngredientDraft(initial: IngredientDraftInitial) {
  const t = useTranslations('recipes.addIngredient')
  const id = useId()
  const nameRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(initial.name)
  const [category, setCategory] = useState<IngredientCategory | undefined>(initial.category)
  const [proteinType, setProteinType] = useState<ProteinType | undefined>(
    initial.proteinType ?? undefined,
  )
  const [unit, setUnit] = useState<Unit>(initial.defaultUnit ?? 'g')
  const [gramsPerPiece, setGramsPerPiece] = useState<number | null>(initial.gramsPerPiece ?? null)
  const [allergens, setAllergens] = useState<Allergen[]>(initial.allergens ?? [])
  const [nutrition, setNutrition] = useState<Record<NutritionField, number | null>>({
    calories: initial.calories ?? null,
    protein: initial.protein ?? null,
    carbs: initial.carbs ?? null,
    fat: initial.fat ?? null,
    fiber: initial.fiber ?? null,
  })
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({})

  /** The request body, or null with the errors shown. */
  const validate = (): NewIngredientInput | null => {
    const errors: Partial<Record<Field, string>> = {}
    const trimmed = name.trim()
    if (!trimmed) errors.name = t('errors.required')
    if (!category) errors.category = t('errors.chooseCategory')
    if (category && isProteinTypedCategory(category) && !proteinType) {
      errors.proteinType = t('errors.chooseProteinType')
    }
    if (unit === 'piece' && !(gramsPerPiece && gramsPerPiece <= GRAMS_PER_PIECE_MAX)) {
      errors.gramsPerPiece = t('errors.gramsPerPiece', { max: GRAMS_PER_PIECE_MAX })
    }
    for (const field of NUTRITION_FIELDS) {
      const value = nutrition[field]
      if (value === null) {
        if (field !== 'fiber') errors[field] = t('errors.required')
      } else if (value < 0 || value > NUTRITION_MAX[field]) {
        errors[field] = t('errors.range', { min: 0, max: NUTRITION_MAX[field] })
      }
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0 || !category) return null

    return {
      name: trimmed,
      category,
      ...(isProteinTypedCategory(category) ? { proteinType } : {}),
      defaultUnit: unit,
      ...(unit === 'piece' ? { gramsPerPiece } : {}),
      allergens,
      calories: nutrition.calories!,
      protein: nutrition.protein!,
      carbs: nutrition.carbs!,
      fat: nutrition.fat!,
      ...(nutrition.fiber !== null ? { fiber: nutrition.fiber } : {}),
    }
  }

  /** Marks the fields a 400's `details` names; false when it names none of them. */
  const markServerErrors = (body: unknown): boolean => {
    const details = (body as { details?: Record<string, unknown> }).details ?? {}
    const marked = FIELDS.filter((field) => field in details)
    setFieldErrors(Object.fromEntries(marked.map((field) => [field, t('errors.check')])))
    return marked.length > 0
  }

  /** Marks the name, for a name the catalogue already has. */
  const markName = (message: string) => setFieldErrors({ name: message })

  return {
    id,
    nameRef,
    values: { name, category, proteinType, unit, gramsPerPiece, allergens, nutrition },
    set: {
      setName,
      setCategory,
      setProteinType,
      setUnit,
      setGramsPerPiece,
      setAllergens,
      setNutrition,
    },
    fieldErrors,
    validate,
    markServerErrors,
    markName,
  }
}

export type IngredientDraft = ReturnType<typeof useIngredientDraft>

function CategoryOption({ value }: { value: IngredientCategory }) {
  return <SelectItem value={value}>{useEnumLabel('IngredientCategory', value)}</SelectItem>
}

function ProteinTypeOption({ value }: { value: ProteinType }) {
  const label = useEnumLabel('ProteinType', value)
  const t = useTranslations('recipes.addIngredient')
  // "No protein" reads wrong for vegan cheese: `none` is the plant-based choice.
  return <SelectItem value={value}>{value === 'none' ? t('proteinTypeNone') : label}</SelectItem>
}

function ContainsToggle({
  value,
  pressed,
  onPressedChange,
}: {
  value: Allergen
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
}) {
  return (
    <Toggle
      variant="outline"
      tone="primary"
      size="chip"
      indicator
      pressed={pressed}
      onPressedChange={onPressedChange}
    >
      {useEnumLabel('Allergen', value)}
    </Toggle>
  )
}

export function IngredientFields({ draft }: { draft: IngredientDraft }) {
  const t = useTranslations('recipes.addIngredient')
  const { id, nameRef, values, set, fieldErrors } = draft
  const { name, category, proteinType, unit, gramsPerPiece, allergens, nutrition } = values

  const handleCategoryChange = (value: string) => {
    const next = value as IngredientCategory
    set.setCategory(next)
    set.setProteinType(defaultProteinType(next))
  }

  const fieldId = (field: string) => `${id}-${field}`
  const errorFor = (field: Field) => {
    const message = fieldErrors[field]
    return message ? <FieldError id={fieldId(`${field}-error`)}>{message}</FieldError> : null
  }
  const describedBy = (field: Field) => (fieldErrors[field] ? fieldId(`${field}-error`) : undefined)

  const proteinTypes =
    category && isProteinTypedCategory(category) ? PROTEIN_TYPES_BY_CATEGORY[category] : null

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={fieldId('name')}>{t('name')}</Label>
        <Input
          ref={nameRef}
          id={fieldId('name')}
          value={name}
          maxLength={NEW_INGREDIENT_NAME_MAX}
          onChange={(e) => set.setName(e.target.value)}
          aria-invalid={!!fieldErrors.name}
          aria-describedby={describedBy('name')}
        />
        {errorFor('name')}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={fieldId('category')}>{t('category')}</Label>
        <Select value={category ?? ''} onValueChange={handleCategoryChange}>
          <SelectTrigger
            id={fieldId('category')}
            className="w-full"
            aria-invalid={!!fieldErrors.category}
            aria-describedby={describedBy('category')}
          >
            <SelectValue placeholder={t('categoryPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {INGREDIENT_CATEGORIES.map((value) => (
              <CategoryOption key={value} value={value} />
            ))}
          </SelectContent>
        </Select>
        {errorFor('category')}
      </div>

      {proteinTypes && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={fieldId('proteinType')}>{t('proteinType')}</Label>
          <Select
            value={proteinType ?? ''}
            onValueChange={(value) => set.setProteinType(value as ProteinType)}
          >
            <SelectTrigger
              id={fieldId('proteinType')}
              className="w-full"
              aria-invalid={!!fieldErrors.proteinType}
              aria-describedby={describedBy('proteinType')}
            >
              <SelectValue placeholder={t('proteinTypePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {proteinTypes.map((value) => (
                <ProteinTypeOption key={value} value={value} />
              ))}
            </SelectContent>
          </Select>
          {errorFor('proteinType')}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label id={fieldId('unit')}>{t('unit')}</Label>
        <ChoiceChips
          aria-labelledby={fieldId('unit')}
          size="sm"
          value={unit}
          onValueChange={(value) => set.setUnit(value as Unit)}
          options={[
            { value: 'g', label: t('unitG') },
            { value: 'piece', label: t('unitPiece') },
          ]}
        />
      </div>

      {unit === 'piece' && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={fieldId('gramsPerPiece')}>{t('gramsPerPiece')}</Label>
          <NumberInput
            id={fieldId('gramsPerPiece')}
            value={gramsPerPiece}
            onValueChange={set.setGramsPerPiece}
            aria-invalid={!!fieldErrors.gramsPerPiece}
            aria-describedby={describedBy('gramsPerPiece')}
          />
          {errorFor('gramsPerPiece')}
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2">
          <Label asChild>
            <span>{t('allergens')}</span>
          </Label>
        </legend>
        <div className="flex flex-wrap gap-2">
          {ALLERGEN_VALUES.map((allergen) => (
            <ContainsToggle
              key={allergen}
              value={allergen}
              pressed={allergens.includes(allergen)}
              onPressedChange={(pressed) =>
                set.setAllergens((current) =>
                  pressed ? [...current, allergen] : current.filter((a) => a !== allergen),
                )
              }
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2">
          <Label asChild>
            <span>{t('nutrition')}</span>
          </Label>
        </legend>
        <div className="grid grid-cols-2 gap-3">
          {NUTRITION_FIELDS.map((field) => (
            <div key={field} className="flex min-w-0 flex-col gap-2">
              <Label htmlFor={fieldId(field)}>{t(field)}</Label>
              <NumberInput
                id={fieldId(field)}
                value={nutrition[field]}
                onValueChange={(value) =>
                  set.setNutrition((current) => ({ ...current, [field]: value }))
                }
                aria-invalid={!!fieldErrors[field]}
                aria-describedby={describedBy(field)}
                aria-required={field !== 'fiber'}
              />
              {errorFor(field)}
            </div>
          ))}
        </div>
      </fieldset>
    </>
  )
}
