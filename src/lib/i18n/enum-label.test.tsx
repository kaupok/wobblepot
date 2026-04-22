import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { PropsWithChildren } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { useEnumLabel } from './enum-label'

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

describe('useEnumLabel (client)', () => {
  it('returns the English label for a MealType value', () => {
    const { result } = renderHook(() => useEnumLabel('MealType', 'breakfast'), {
      wrapper: makeWrapper('en'),
    })
    expect(result.current).toBe('Breakfast')
  })

  it('returns the Estonian label for a MealType value', () => {
    const { result } = renderHook(() => useEnumLabel('MealType', 'dinner'), {
      wrapper: makeWrapper('et'),
    })
    expect(result.current).toBe('Õhtusöök')
  })

  it('covers all three meal types in English', () => {
    const { result: breakfast } = renderHook(() => useEnumLabel('MealType', 'breakfast'), {
      wrapper: makeWrapper('en'),
    })
    const { result: lunch } = renderHook(() => useEnumLabel('MealType', 'lunch'), {
      wrapper: makeWrapper('en'),
    })
    const { result: dinner } = renderHook(() => useEnumLabel('MealType', 'dinner'), {
      wrapper: makeWrapper('en'),
    })
    expect(breakfast.current).toBe('Breakfast')
    expect(lunch.current).toBe('Lunch')
    expect(dinner.current).toBe('Dinner')
  })
})
