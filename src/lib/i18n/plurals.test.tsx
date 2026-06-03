// Use the real next-intl in this file: the global mock in vitest.setup.ts
// returns the catalog string verbatim and never resolves ICU plural rules.
import { vi, describe, it, expect } from 'vitest'
vi.unmock('next-intl')
import { renderHook } from '@testing-library/react'
import { NextIntlClientProvider, useTranslations } from 'next-intl'
import type { PropsWithChildren } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'

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

describe('shopping.itemCount plural rendering', () => {
  it('renders =0/one/other in en', () => {
    const { result } = renderHook(() => useTranslations('shopping'), {
      wrapper: makeWrapper('en'),
    })
    expect(result.current('itemCount', { count: 0 })).toBe('No items')
    expect(result.current('itemCount', { count: 1 })).toBe('1 item')
    expect(result.current('itemCount', { count: 5 })).toBe('5 items')
  })

  it('renders =0/one/other in et', () => {
    const { result } = renderHook(() => useTranslations('shopping'), {
      wrapper: makeWrapper('et'),
    })
    expect(result.current('itemCount', { count: 0 })).toBe('Tooteid pole')
    expect(result.current('itemCount', { count: 1 })).toBe('1 toode')
    expect(result.current('itemCount', { count: 5 })).toBe('5 toodet')
  })
})

describe('pantry.ingredientCount plural rendering', () => {
  it('renders =0/one/other in en', () => {
    const { result } = renderHook(() => useTranslations('pantry'), {
      wrapper: makeWrapper('en'),
    })
    expect(result.current('ingredientCount', { count: 0 })).toBe('No items')
    expect(result.current('ingredientCount', { count: 1 })).toBe('1 item')
    expect(result.current('ingredientCount', { count: 7 })).toBe('7 items')
  })

  it('renders =0/one/other in et', () => {
    const { result } = renderHook(() => useTranslations('pantry'), {
      wrapper: makeWrapper('et'),
    })
    expect(result.current('ingredientCount', { count: 0 })).toBe('Tooteid pole')
    expect(result.current('ingredientCount', { count: 1 })).toBe('1 toode')
    expect(result.current('ingredientCount', { count: 7 })).toBe('7 toodet')
  })
})

describe('recipes.mealCount + mealCountMore plural rendering', () => {
  it('renders mealCount in en', () => {
    const { result } = renderHook(() => useTranslations('recipes'), {
      wrapper: makeWrapper('en'),
    })
    expect(result.current('mealCount', { count: 0 })).toBe('No recipes')
    expect(result.current('mealCount', { count: 1 })).toBe('1 recipe')
    expect(result.current('mealCount', { count: 12 })).toBe('12 recipes')
  })

  it('renders mealCount in et', () => {
    const { result } = renderHook(() => useTranslations('recipes'), {
      wrapper: makeWrapper('et'),
    })
    expect(result.current('mealCount', { count: 0 })).toBe('Retsepte pole')
    expect(result.current('mealCount', { count: 1 })).toBe('1 retsept')
    expect(result.current('mealCount', { count: 12 })).toBe('12 retsepti')
  })

  it('renders mealCountMore (with + suffix) in en', () => {
    const { result } = renderHook(() => useTranslations('recipes'), {
      wrapper: makeWrapper('en'),
    })
    expect(result.current('mealCountMore', { count: 1 })).toBe('1+ recipe')
    expect(result.current('mealCountMore', { count: 20 })).toBe('20+ recipes')
  })

  it('renders mealCountMore (with + suffix) in et', () => {
    const { result } = renderHook(() => useTranslations('recipes'), {
      wrapper: makeWrapper('et'),
    })
    expect(result.current('mealCountMore', { count: 1 })).toBe('1+ retsept')
    expect(result.current('mealCountMore', { count: 20 })).toBe('20+ retsepti')
  })
})

describe('dates.inDays plural rendering', () => {
  it('renders one/other in en', () => {
    const { result } = renderHook(() => useTranslations('dates'), {
      wrapper: makeWrapper('en'),
    })
    expect(result.current('inDays', { count: 1 })).toBe('In 1 day')
    expect(result.current('inDays', { count: 8 })).toBe('In 8 days')
  })

  it('renders one/other in et — partitive form is shared', () => {
    const { result } = renderHook(() => useTranslations('dates'), {
      wrapper: makeWrapper('et'),
    })
    // Estonian uses the partitive form "päeva" after both 1 and N for the
    // "in N days" expression. The string is identical for one / other; ICU
    // still requires the rules to be present.
    expect(result.current('inDays', { count: 1 })).toBe('1 päeva pärast')
    expect(result.current('inDays', { count: 8 })).toBe('8 päeva pärast')
  })
})

describe('meal-plan.firstTime.dayOption plural rendering (HON-554 item 3)', () => {
  it('renders one/other in en', () => {
    const { result } = renderHook(() => useTranslations('meal-plan.firstTime'), {
      wrapper: makeWrapper('en'),
    })
    expect(result.current('dayOption', { count: 3 })).toBe('3 days')
    expect(result.current('dayOption', { count: 14 })).toBe('14 days')
  })

  it('renders one/other in et', () => {
    const { result } = renderHook(() => useTranslations('meal-plan.firstTime'), {
      wrapper: makeWrapper('et'),
    })
    // All first-run duration options are > 1, so they take the partitive "päeva".
    expect(result.current('dayOption', { count: 3 })).toBe('3 päeva')
    expect(result.current('dayOption', { count: 5 })).toBe('5 päeva')
    expect(result.current('dayOption', { count: 14 })).toBe('14 päeva')
  })
})

describe('meal-plan portion (portsjon) numeral agreement in et (HON-554 item 4)', () => {
  it('ingredients header uses nominative singular for 1, partitive for N>1', () => {
    const { result } = renderHook(() => useTranslations('meal-plan.detail'), {
      wrapper: makeWrapper('et'),
    })
    expect(result.current('ingredientsHeader', { count: 1 })).toBe('Koostisosad (1 portsjon)')
    expect(result.current('ingredientsHeader', { count: 4 })).toBe('Koostisosad (4 portsjonit)')
  })

  it('serving stepper label uses nominative singular for 1, partitive for N>1', () => {
    const { result } = renderHook(() => useTranslations('meal-plan.serving'), {
      wrapper: makeWrapper('et'),
    })
    expect(result.current('labelWithCount', { count: 1 })).toBe('1 portsjon')
    expect(result.current('labelWithCount', { count: 4 })).toBe('4 portsjonit')
    expect(result.current('ariaButton', { count: 1 })).toBe('1 portsjon. Klõpsa, et muuta.')
  })

  it('en ingredients header is unaffected', () => {
    const { result } = renderHook(() => useTranslations('meal-plan.detail'), {
      wrapper: makeWrapper('en'),
    })
    expect(result.current('ingredientsHeader', { count: 1 })).toBe('Ingredients (serves 1)')
    expect(result.current('ingredientsHeader', { count: 4 })).toBe('Ingredients (serves 4)')
  })
})

describe('household.portion multiplier decimal separator (HON-554 item 6)', () => {
  it('renders an Estonian decimal comma in et', () => {
    const { result } = renderHook(() => useTranslations('household.portion'), {
      wrapper: makeWrapper('et'),
    })
    expect(result.current('preset', { label: 'Väike', multiplier: 0.75 })).toBe('Väike (0,75x)')
    expect(result.current('preset', { label: 'Suur', multiplier: 1.5 })).toBe('Suur (1,5x)')
    // Integer multipliers render without a decimal part.
    expect(result.current('preset', { label: 'Tavaline', multiplier: 1 })).toBe('Tavaline (1x)')
    expect(result.current('custom', { multiplier: 1.25 })).toBe('Kohandatud portsjon (1,25x)')
  })

  it('renders a decimal point in en (unchanged)', () => {
    const { result } = renderHook(() => useTranslations('household.portion'), {
      wrapper: makeWrapper('en'),
    })
    expect(result.current('preset', { label: 'Small', multiplier: 0.75 })).toBe('Small (0.75x)')
    expect(result.current('preset', { label: 'Large', multiplier: 1.5 })).toBe('Large (1.5x)')
  })
})
