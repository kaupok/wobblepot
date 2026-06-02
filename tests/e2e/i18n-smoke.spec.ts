// ROUTES: /, /household · COMPONENTS: Header, MealTypeCheckbox, HouseholdSettingsForm
import { test, expect } from '@playwright/test'
import { signUpWithHousehold } from './utils/test-helpers'

/**
 * Platform i18n smoke — catches framework regressions on every PR.
 *
 *   1. Signed-out user with Estonian browser → Estonian chrome
 *      (verifies `<html lang>`, catalog string, resolver → Accept-Language path).
 *   2. New household created during onboarding with Estonian browser → onboarding
 *      persists `Household.locale = "et"` (HON-549 — `et` is public, so the
 *      Accept-Language-resolved locale is no longer clamped to English).
 *      `useEnumLabel('MealType', 'breakfast')` therefore renders "Hommikusöök"
 *      on the household settings form.
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

  test('onboarding persists Estonian Accept-Language locale (HON-549 — et is public)', async ({
    page,
  }) => {
    // Sign up + onboarding helpers use English-only labels (sign-up /
    // onboarding chrome is not externalized), so they work fine against an
    // Estonian-browser session.
    await signUpWithHousehold(page)

    // HON-549: `et` is now in PUBLIC_LOCALES and the onboarding clamp is gone,
    // so the Accept-Language-resolved `et` round-trips into `Household.locale`
    // and chrome stays Estonian after the household row exists.
    await expect(page.locator('html')).toHaveAttribute('lang', 'et')

    // `MealTypeCheckbox` → `useEnumLabel('MealType', 'breakfast')` renders the
    // Estonian label on the household settings form.
    await page.goto('/household')
    await expect(page.getByText('Hommikusöök').first()).toBeVisible()
  })
})
