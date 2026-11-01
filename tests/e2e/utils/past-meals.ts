import { expect, type Page } from '@playwright/test'

import { e2eBaseURL } from './db-helpers'
import { signIn } from './test-helpers'

/**
 * The page and API reads the past-meals specs share: `past-meals.spec.ts`
 * and `cooked-have-some.spec.ts` (HON-1564), both on the smoke household.
 */

// A past day's heading line: its heading, and the "+ Add" for the meal types
// the day does not expect (HON-1519).
export const headingLine = (page: Page, date: string) =>
  page.locator(`div:has(> #past-day-${date})`)
// The day's rows sit in the `RowGroup` right after its heading line.
export const dayRows = (page: Page, date: string) =>
  page.locator(`div:has(> #past-day-${date}) + [data-slot="row-group"]`)

export interface MealSummary {
  id: string
  name: string
  components: { ingredientId: string; quantityPerServing: number; isVague?: boolean }[]
}

export interface EntrySummary {
  id: string
  date: string
  mealType: string
  status: string
  rating: string | null
  pantryDeducted?: boolean
  meal: MealSummary | null
}

export function daysFromNow(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toISOString().slice(0, 10)
}

/**
 * Signs in as a seeded fixture. The spec passes `smokeFixture()` itself, so
 * `shared-fixture-specs.test.ts` still sees which specs use the fixture.
 */
export async function signInWithConsent(
  page: Page,
  { email, password }: { email: string; password: string },
) {
  // Pre-grant consent so the CookieBanner cannot take focus or clicks.
  await page
    .context()
    .addCookies([{ name: 'consent-v1', value: 'essential', url: e2eBaseURL(), sameSite: 'Lax' }])
  await signIn(page, email, password)
}

export async function listEntries(page: Page) {
  const response = await page.request.get(
    `/api/entries?startDate=${daysFromNow(-8)}&endDate=${daysFromNow(16)}`,
  )
  expect(response.ok()).toBe(true)
  return (await response.json()) as { entries: EntrySummary[]; planId: string | null }
}
