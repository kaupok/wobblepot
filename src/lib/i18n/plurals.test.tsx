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
