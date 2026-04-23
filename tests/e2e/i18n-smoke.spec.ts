import { test, expect } from '@playwright/test'
import { signUpWithHousehold } from './utils/test-helpers'

/**
 * Platform i18n smoke — catches framework regressions on every PR.
 *
 *   1. Signed-out user with Estonian browser → Estonian chrome
 *      (verifies `<html lang>`, catalog string, resolver → Accept-Language path).
 *   2. New household created during onboarding with Estonian browser → the
 *      onboarding path clamps to `PUBLIC_LOCALES` (HON-524), so
 *      `Household.locale = "en"` is persisted and chrome flips to English
 *      post-sign-up. `useEnumLabel('MealType', 'breakfast')` therefore renders
 *      "Breakfast" on the household settings form. The Estonian enum-label
 *      path is exercised by unit + Storybook tests, not here — there is no
 *      UI-reachable way to reach an Estonian household while `PUBLIC_LOCALES
 *      = ['en']`.
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

  test('onboarding clamps Estonian-browser locale to PUBLIC_LOCALES', async ({ page }) => {
    // Sign up + onboarding helpers use English-only labels (sign-up /
    // onboarding chrome is not externalized), so they work fine against an
    // Estonian-browser session.
    await signUpWithHousehold(page)

    // HON-524: onboarding clamps Accept-Language-resolved `et` to
    // DEFAULT_LOCALE because `et` isn't in PUBLIC_LOCALES yet. Chrome therefore
    // flips to English the moment the household row exists.
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    // `MealTypeCheckbox` → `useEnumLabel('MealType', 'breakfast')` renders the
    // English label on the household settings form after the clamp.
    await page.goto('/household')
    await expect(page.getByText('Breakfast').first()).toBeVisible()
  })
})
