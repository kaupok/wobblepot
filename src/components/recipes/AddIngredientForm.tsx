'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
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
import { Body } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import { ALLERGEN_VALUES } from '@/components/household/AllergenPicker'
import { apiFetch, ApiError } from '@/lib/api'
import { useEnumLabel } from '@/lib/i18n/enum-label'
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
import type { IngredientResult } from '@/hooks/use-ingredient-search'
import type { Allergen, IngredientCategory, ProteinType, Unit } from '@/generated/prisma/enums'

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

interface AddIngredientFormProps {
  /** The name the recipe used, prefilled. */
  extractedName: string
  /** Called with the saved ingredient: a new household row, or the one the name already meant. */
  onCreated: (ingredient: IngredientResult) => void
  onCancel: () => void
}

/**
 * "Add as new ingredient" from an unmatched ingredient row (HON-1263). The
 * household enters what the pack label says, per 100 g, and ticks the
 * allergens: the planner's allergen filter trusts them, and nothing else
 * checks them. Not a `<form>`, because the meal form around it is one.
 */
export function AddIngredientForm({ extractedName, onCreated, onCancel }: AddIngredientFormProps) {
  const t = useTranslations('recipes.addIngredient')
  const id = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  const [name, setName] = useState(extractedName)
  const [category, setCategory] = useState<IngredientCategory | undefined>()
  const [proteinType, setProteinType] = useState<ProteinType | undefined>()
  const [unit, setUnit] = useState<Unit>('g')
  const [gramsPerPiece, setGramsPerPiece] = useState<number | null>(null)
  const [allergens, setAllergens] = useState<Allergen[]>([])
  const [nutrition, setNutrition] = useState<Record<NutritionField, number | null>>({
    calories: null,
    protein: null,
    carbs: null,
    fat: null,
    fiber: null,
  })
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const create = useMutation({
    mutationFn: (input: NewIngredientInput) =>
      apiFetch<{ ingredient: IngredientResult }>('/api/ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: ({ ingredient }) => {
      void queryClient.invalidateQueries({ queryKey: ['ingredients'] })
      onCreated(ingredient)
    },
    onError: (error) => {
      // The route's `error` is English, for logs; the form renders catalog copy.
      console.error('[AddIngredientForm] Save failed:', error.message)
      if (error instanceof ApiError && error.status === 429) {
        setFormError(t('errors.rateLimited'))
      } else if (error instanceof ApiError && error.status === 400) {
        const details = (error.body as { details?: Record<string, unknown> }).details ?? {}
        const marked = FIELDS.filter((field) => field in details)
        setFieldErrors(Object.fromEntries(marked.map((field) => [field, t('errors.check')])))
        setFormError(marked.length > 0 ? null : t('errors.generic'))
      } else {
        setFormError(t('errors.generic'))
      }
    },
  })

  const handleCategoryChange = (value: string) => {
    const next = value as IngredientCategory
    setCategory(next)
    setProteinType(defaultProteinType(next))
  }

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
    setFormError(null)
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

  const handleSave = () => {
    // `aria-disabled`, not `disabled`, so focus stays on Save while it runs;
    // this guard is what stops a second tap (docs/DESIGN.md → Focus management).
    if (create.isPending) return
    const input = validate()
    if (input) create.mutate(input)
  }

  // The meal form around this is a `<form>`: Enter in a field saves the
  // ingredient here rather than submitting the meal.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault()
      handleSave()
    }
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
    <div
      role="group"
      aria-labelledby={fieldId('title')}
      className="flex flex-col gap-4"
      onKeyDown={handleKeyDown}
    >
      <div className="flex flex-col gap-1">
        <Body id={fieldId('title')} variant="small">
          {t('title')}
        </Body>
        <Body variant="muted">{t('hint')}</Body>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={fieldId('name')}>{t('name')}</Label>
        <Input
          ref={nameRef}
          id={fieldId('name')}
          value={name}
          maxLength={NEW_INGREDIENT_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
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
            onValueChange={(value) => setProteinType(value as ProteinType)}
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
          onValueChange={(value) => setUnit(value as Unit)}
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
            onValueChange={setGramsPerPiece}
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
                setAllergens((current) =>
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
                  setNutrition((current) => ({ ...current, [field]: value }))
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

      {formError && <FieldError>{formError}</FieldError>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleSave} aria-disabled={create.isPending || undefined}>
          {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('save')}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  )
}
