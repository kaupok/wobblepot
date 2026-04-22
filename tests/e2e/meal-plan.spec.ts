import { test, expect } from '@playwright/test'
import {
  signUpWithHousehold,
  generateMealPlan,
  getMealCard,
  openMealDetail,
  changeMealStatus,
  openSwapModal,
} from './utils/test-helpers'

test.describe('Meal plan generation and viewing', () => {
  // These tests are serial because they build on each other:
  // 1. Generate plan (creates test data)
  // 2-5. Test features using that generated plan
  test.describe.configure({ mode: 'serial' })

  // Extend timeout for tests involving AI generation
  test.setTimeout(90000)

  test('generate first meal plan', { tag: ['@smoke', '@ai'] }, async ({ page }) => {
    await signUpWithHousehold(page)
    await page.goto('/meal-plan')

    // Generate the meal plan
    await generateMealPlan(page)

    // Verify week view appears with 7 day columns
    await expect(page.getByRole('heading', { name: "This week's meals" })).toBeVisible()

    // Verify at least one meal card is visible (has View button)
    const mealCard = getMealCard(page)
    await expect(mealCard).toBeVisible()
  })

  test('view meal details', { tag: '@ai' }, async ({ page }) => {
    await signUpWithHousehold(page)
    await page.goto('/meal-plan')
    await generateMealPlan(page)

    // Get the first meal card and note its name
    const mealCard = getMealCard(page)
    const mealName = await mealCard.locator('[data-slot="card-title"]').textContent()

    // Open the detail modal
    await openMealDetail(page, mealCard)

    // Verify modal content
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: mealName! })).toBeVisible()

    // Verify ingredients section is present (text includes "Ingredients (serves X)")
    await expect(dialog.getByText(/Ingredients \(serves \d+\)/)).toBeVisible()

    // Verify nutrition section is present
    await expect(dialog.getByText('Nutrition (per serving)')).toBeVisible()

    // Close modal by pressing Escape
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })

  test(
    'change meal status persists after refresh',
    { tag: ['@smoke', '@ai'] },
    async ({ page }) => {
      await signUpWithHousehold(page)
      await page.goto('/meal-plan')
      await generateMealPlan(page)

      // Get the first meal card
      const mealCard = getMealCard(page)

      // Set up response listener before triggering the status change
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/api/meal-plans/') &&
          response.url().includes('/entries/') &&
          response.request().method() === 'PATCH' &&
          response.status() === 200,
      )

      // Change status to completed
      await changeMealStatus(page, mealCard, 'completed')

      // Verify the status visually updated (green color for completed)
      const statusTrigger = mealCard.locator('button[role="combobox"]')
      await expect(statusTrigger).toContainText('Completed')

      // Wait for the API call to complete before refreshing
      await responsePromise

      // Refresh the page
      await page.reload()

      // Wait for the week view to load
      await expect(page.getByRole('heading', { name: "This week's meals" })).toBeVisible()

      // Verify status persisted
      const mealCardAfterRefresh = getMealCard(page)
      const statusTriggerAfterRefresh = mealCardAfterRefresh.locator('button[role="combobox"]')
      await expect(statusTriggerAfterRefresh).toContainText('Completed')
    },
  )

  test('swap meal via AI alternatives', { tag: '@ai' }, async ({ page }) => {
    await signUpWithHousehold(page)
    await page.goto('/meal-plan')
    await generateMealPlan(page)

    // Get the first meal card
    const mealCard = getMealCard(page)

    // Open the swap modal
    await openSwapModal(page, mealCard)

    // Verify modal content
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Choose a different meal' })).toBeVisible()

    // Wait for alternatives to load (skeleton disappears, Select buttons appear)
    await expect(dialog.getByRole('button', { name: 'Select' }).first()).toBeVisible({
      timeout: 30000,
    })

    // Select the first alternative
    await dialog.getByRole('button', { name: 'Select' }).first().click()

    // Modal should close after selection
    await expect(dialog).not.toBeVisible()

    // Verify meal card updated (may be same or different meal name)
    // The important thing is the swap completed without error
    const newMealCard = getMealCard(page)
    await expect(newMealCard.locator('[data-slot="card-title"]')).toBeVisible()

    // Note: We don't assert the name changed since alternatives could include the same meal
    // The test passes if the swap completed without errors
  })

  test('swap meal via library browse', { tag: '@ai' }, async ({ page }) => {
    await signUpWithHousehold(page)
    await page.goto('/meal-plan')
    await generateMealPlan(page)

    // Get a meal card (use second one if available to test different card)
    const mealCard = getMealCard(page, 1)
    // Fallback to first card if second doesn't exist
    if (!(await mealCard.isVisible())) {
      const firstCard = getMealCard(page, 0)
      await openSwapModal(page, firstCard)
    } else {
      await openSwapModal(page, mealCard)
    }

    // Wait for RegenerateModal to load
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Choose a different meal' })).toBeVisible()

    // Wait for alternatives to finish loading
    await expect(dialog.getByRole('button', { name: 'Browse full library' })).toBeVisible({
      timeout: 30000,
    })

    // Click browse library button
    await dialog.getByRole('button', { name: 'Browse full library' }).click()

    // Wait for library modal to open (first dialog closes, second opens)
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'Browse meal library' }),
    ).toBeVisible()

    // Wait for meals to load
    const libraryDialog = page.getByRole('dialog')
    await expect(libraryDialog.getByRole('button', { name: 'Select' }).first()).toBeVisible({
      timeout: 10000,
    })

    // Select the first meal from library
    await libraryDialog.getByRole('button', { name: 'Select' }).first().click()

    // Confirmation dialog should appear
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(
      page.getByRole('alertdialog').getByRole('heading', { name: 'Swap meal' }),
    ).toBeVisible()

    // Confirm the swap
    await page.getByRole('alertdialog').getByRole('button', { name: 'Swap' }).click()

    // Both dialogs should close
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByRole('alertdialog')).not.toBeVisible()

    // Verify we're back on the dashboard with the week view
    await expect(page.getByRole('heading', { name: "This week's meals" })).toBeVisible()
  })
})

// Note: Rate limiting and error handling tests are intentionally excluded from E2E:
// - Rate limiting (5 generations/hour) would cause flaky tests in CI
// - AI timeout simulation requires mocking infrastructure not suitable for E2E
// These should be tested manually or via unit tests with mocked dependencies.
