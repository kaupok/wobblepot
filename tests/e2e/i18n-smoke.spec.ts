import { test, expect } from '@playwright/test'
import { signUpWithHousehold } from './utils/test-helpers'

/**
 * Platform i18n smoke — catches framework regressions on every PR.
 *
 * Per HON-501:
 *   1. Signed-out user with Estonian browser → Estonian chrome
 *      (verifies `<html lang>`, catalog string, resolver → Accept-Language path)
 *   2. New household created during onboarding with Estonian browser →
 *      `Household.locale = "et"` persisted (resolver output, not hardcoded "en")
 *      and the MealType enum label renders in Estonian via `useEnumLabel`.
 */

test.describe('@i18n platform smoke', () => {
  test.use({ locale: 'et-EE' })

  test('signed-out landing renders in Estonian when browser prefers et', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'et')
    await expect(
      page.getByRole('heading', { name: 'Söögiplaanid hõivatud peredele' }),
    ).toBeVisible()
  })

  test('new household persists resolved locale and MealType renders in et', async ({ page }) => {
    // Sign up + onboarding helpers use English-only labels (sign-up /
    // onboarding chrome is not externalized in this issue), so they work fine
    // against an Estonian-browser session.
    await signUpWithHousehold(page)

    // After creation, chrome must still be in Estonian — locale did not snap
    // back when Household.locale was persisted.
    await expect(page.locator('html')).toHaveAttribute('lang', 'et')

    // `MealTypeCheckbox` → `useEnumLabel('MealType', 'breakfast')` renders the
    // Estonian label "Hommikusöök" in the household settings form.
    await page.goto('/household')
    await expect(page.getByText('Hommikusöök').first()).toBeVisible()
  })
})
