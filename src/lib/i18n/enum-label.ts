import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'

/**
 * Catalog namespace that holds enum label translations.
 * Keys look like `enums.MealType.breakfast`, `enums.DietaryType.vegan`, etc.
 */
const ENUM_NAMESPACE = 'enums'

export type EnumName = 'MealType'

/**
 * Server-side typed enum label lookup.
 * Reads from `enums.<EnumName>.<value>` in the active request's message catalog.
 */
export async function getEnumLabel<Name extends EnumName>(
  enumName: Name,
  value: string,
): Promise<string> {
  const t = await getTranslations(`${ENUM_NAMESPACE}.${enumName}`)
  // next-intl types message keys from a generated IntlMessages shape we don't
  // configure. The enum catalog is flat `string → string`, so a literal cast
  // is safe here — runtime behavior is an ordinary object lookup with fallback.
  return (t as unknown as (key: string) => string)(value)
}

/**
 * Client-side typed enum label lookup. Must be called inside a component that
 * is wrapped in `NextIntlClientProvider`.
 */
export function useEnumLabel<Name extends EnumName>(enumName: Name, value: string): string {
  const t = useTranslations(`${ENUM_NAMESPACE}.${enumName}`)
  return (t as unknown as (key: string) => string)(value)
}
