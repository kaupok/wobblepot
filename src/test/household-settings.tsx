import { act, render, screen } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { vi } from 'vitest'
import enMessages from '../../messages/en.json'
import etMessages from '../../messages/et.json'
import { createQueryWrapper } from './query-wrapper'
import type { HouseholdPreferencesValues } from '@/app/household/meal-preferences/preference-values'

/**
 * Shared fixtures for the household settings form tests (HON-1257): the
 * Household details form on the Settings tab, and the Food preferences and
 * Meals to plan forms on the Meal preferences tab. Each test file keeps its
 * own `vi.mock` calls, which Vitest hoists per file, and installs `mockFetch`:
 *
 *   global.fetch = mockFetch
 */

export const mockFetch = vi.fn()

export const OWNER_ONLY_NOTICE =
  'Only the household owner can change these settings. You can see them here.'

export const defaultHousehold = {
  id: 'household-1',
  name: 'Test Household',
  timezone: 'Europe/Tallinn',
  locale: 'en' as const,
}

export const defaultPreferences: HouseholdPreferencesValues = {
  dietaryType: null,
  allergensToAvoid: [],
  restrictions: [],
  excludedIngredients: [],
  weekdayMealTypes: ['dinner'],
  weekendMealTypes: ['dinner'],
}

export const ok = () => ({ ok: true, json: () => Promise.resolve({}) })
export const fail = (status: number, error: string) => ({
  ok: false,
  status,
  json: () => Promise.resolve({ error }),
})

/** Hold the next request open until the returned function answers it. */
export function deferFetch() {
  let answer: (response: unknown) => void = () => {}
  mockFetch.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
  return (response: unknown) => act(() => answer(response))
}

/** The form of the section with this heading. */
export function section(heading: string) {
  return screen.getByRole('form', { name: heading })
}

/**
 * Render with the real catalog for `locale` and a fresh query client. The
 * allergen notice needs `t.rich`, which the global next-intl mock lacks, so a
 * test file that renders it calls `vi.unmock('next-intl')`.
 */
export function renderSettings(ui: ReactElement, locale: 'en' | 'et' = 'en') {
  const { wrapper: QueryWrapper, queryClient } = createQueryWrapper()
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={locale === 'en' ? enMessages : etMessages}>
        <QueryWrapper>{children}</QueryWrapper>
      </NextIntlClientProvider>
    )
  }
  return { ...render(ui, { wrapper: Wrapper }), queryClient }
}

/** The jsdom gaps Radix Select and the tag inputs need filled. */
export function stubPointerApis() {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
}
