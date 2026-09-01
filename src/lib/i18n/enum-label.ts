import { useTranslations } from 'next-intl'

/**
 * Catalog namespace that holds enum label translations.
 * Keys look like `enums.MealType.breakfast`, `enums.DietaryType.vegan`, etc.
 */
const ENUM_NAMESPACE = 'enums'

export type EnumName =
  | 'MealType'
  | 'IngredientCategory'
  | 'ProteinType'
  | 'Unit'
  | 'Allergen'
  | 'DietaryType'
  | 'HouseholdRole'
  | 'MealPlanEntryStatus'

/**
 * Client-side typed enum label lookup. Must be called inside a component that
 * is wrapped in `NextIntlClientProvider`.
 */
export function useEnumLabel<Name extends EnumName>(enumName: Name, value: string): string {
  const t = useTranslations(`${ENUM_NAMESPACE}.${enumName}`)
  return (t as unknown as (key: string) => string)(value)
}
