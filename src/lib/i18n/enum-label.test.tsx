// Use the real next-intl in this file: the global mock in vitest.setup.ts
// hardcodes English; this suite needs locale-switched lookups.
import { vi, describe, it, expect } from 'vitest'
vi.unmock('next-intl')
import { renderHook } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { PropsWithChildren } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import {
  Allergen,
  DietaryType,
  HouseholdRole,
  IngredientCategory,
  MealPlanEntryStatus,
  MealType,
  ProteinType,
  Unit,
} from '@/generated/prisma/enums'
import { useEnumLabel, useVaguePhrase, type EnumName } from './enum-label'

function makeWrapper(locale: 'en' | 'et') {
  const messages = locale === 'et' ? etMessages : enMessages
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    )
  }
}

// Read from the schema, so a new enum value without a catalog key fails here.
const ENUM_VALUES: Record<EnumName, readonly string[]> = {
  MealType: Object.values(MealType),
  IngredientCategory: Object.values(IngredientCategory),
  ProteinType: Object.values(ProteinType),
  Unit: Object.values(Unit),
  Allergen: Object.values(Allergen),
  DietaryType: Object.values(DietaryType),
  HouseholdRole: Object.values(HouseholdRole),
  MealPlanEntryStatus: Object.values(MealPlanEntryStatus),
}

const ENUM_NAMES = Object.keys(ENUM_VALUES) as EnumName[]

describe('useEnumLabel (catalog coverage)', () => {
  describe.each(['en', 'et'] as const)('locale=%s', (locale) => {
    const messages = locale === 'et' ? etMessages : enMessages
    const enumsCatalog = messages.enums as Record<string, Record<string, string>>

    it.each(ENUM_NAMES)('catalog includes every value for %s', (enumName) => {
      const catalog = enumsCatalog[enumName]
      expect(catalog).toBeDefined()
      for (const value of ENUM_VALUES[enumName]) {
        expect(catalog?.[value], `${enumName}.${value} missing in ${locale}`).toBeTruthy()
      }
    })

    it.each(ENUM_NAMES)('useEnumLabel resolves every value for %s', (enumName) => {
      const catalog = enumsCatalog[enumName]
      for (const value of ENUM_VALUES[enumName]) {
        const { result } = renderHook(() => useEnumLabel(enumName, value), {
          wrapper: makeWrapper(locale),
        })
        const expected = catalog?.[value]
        expect(result.current).toBe(expected)
      }
    })
  })

  it('returns the Estonian label for a representative value', () => {
    const { result } = renderHook(() => useEnumLabel('IngredientCategory', 'vegetable'), {
      wrapper: makeWrapper('et'),
    })
    expect(result.current).toBe('Aedviljad')
  })

  it('returns the English label for a representative value', () => {
    const { result } = renderHook(() => useEnumLabel('Allergen', 'nuts'), {
      wrapper: makeWrapper('en'),
    })
    expect(result.current).toBe('Tree nuts')
  })
})

describe('useVaguePhrase', () => {
  it('renders a stored phrase in Estonian (HON-917)', () => {
    const { result } = renderHook(() => useVaguePhrase(), { wrapper: makeWrapper('et') })
    expect(result.current('to taste')).toBe('maitse järgi')
    expect(result.current('a pinch')).toBe('näputäis')
  })

  it('renders the article form in English', () => {
    const { result } = renderHook(() => useVaguePhrase(), { wrapper: makeWrapper('en') })
    expect(result.current('pinch')).toBe('a pinch')
  })

  it('passes a phrase outside the vocabulary through unchanged', () => {
    const { result } = renderHook(() => useVaguePhrase(), { wrapper: makeWrapper('et') })
    expect(result.current('peotäie jagu')).toBe('peotäie jagu')
  })
})
