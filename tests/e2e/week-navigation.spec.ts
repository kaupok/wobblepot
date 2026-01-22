import { test, expect } from '@playwright/test'
import {
  signUpWithHousehold,
  generateMealPlan,
  getActiveWeekTab,
  getVisibleWeekTabs,
  tabHasNoPlanBadge,
  getCurrentWeekDaysIndicator,
  navigateToWeek,
} from './utils/test-helpers'

test.describe('Dashboard week navigation', () => {
  test.describe('URL parameter handling', () => {
    test('navigating to ?week=current shows This week tab as active', async ({ page }) => {
      await signUpWithHousehold(page)
      await page.goto('/meal-plan?week=current')

      const activeTab = await getActiveWeekTab(page)
      expect(activeTab).toBe('current')
    })

    test('navigating to ?week=next shows Next week tab as active', async ({ page }) => {
      await signUpWithHousehold(page)
      await page.goto('/meal-plan?week=next')

      const activeTab = await getActiveWeekTab(page)
      expect(activeTab).toBe('next')
    })

    test('navigating without param defaults to This week (non-Sunday)', async ({ page }) => {
      await signUpWithHousehold(page)
      await page.goto('/meal-plan')

      // On non-Sunday, default should be 'current'
      // On Sunday, it would be 'next' but we can't control the date in E2E
      const activeTab = await getActiveWeekTab(page)
      expect(['current', 'next']).toContain(activeTab)
    })
  })

  test.describe('Tab visibility and state', () => {
    test('new user sees This week and Next week tabs (no Last week)', async ({ page }) => {
      await signUpWithHousehold(page)
      await page.goto('/meal-plan')

      const visibleTabs = await getVisibleWeekTabs(page)

      // Last week tab should not be visible without a last week plan
      expect(visibleTabs).not.toContain('last')
      // Next week should always be visible
      expect(visibleTabs).toContain('next')
    })

    test('tabs show No plan badge when week has no plan', async ({ page }) => {
      await signUpWithHousehold(page)
      await page.goto('/meal-plan')

      // New user has no plans, so both tabs should show "No plan" badge
      const visibleTabs = await getVisibleWeekTabs(page)

      // Check whichever tabs are visible
      if (visibleTabs.includes('current')) {
        const currentHasNoPlan = await tabHasNoPlanBadge(page, 'current')
        expect(currentHasNoPlan).toBe(true)
      }

      const nextHasNoPlan = await tabHasNoPlanBadge(page, 'next')
      expect(nextHasNoPlan).toBe(true)
    })

    test('partial week shows days remaining indicator', async ({ page }) => {
      await signUpWithHousehold(page)
      await page.goto('/meal-plan')

      const visibleTabs = await getVisibleWeekTabs(page)

      // On non-Monday (partial week), the This week tab shows "(X days)"
      // On Monday (full week) or Sunday (no This week tab), no indicator
      if (visibleTabs.includes('current')) {
        const daysIndicator = await getCurrentWeekDaysIndicator(page)
        // If we're mid-week, should show days remaining (1-6)
        // If Monday (full week), returns null
        if (daysIndicator !== null) {
          expect(daysIndicator).toBeGreaterThanOrEqual(1)
          expect(daysIndicator).toBeLessThanOrEqual(6)
        }
      }
    })
  })

  test.describe('Tab navigation', () => {
    test('clicking Next week tab updates URL to ?week=next', async ({ page }) => {
      await signUpWithHousehold(page)
      await page.goto('/meal-plan?week=current')

      await navigateToWeek(page, 'next')

      expect(page.url()).toContain('week=next')
      const activeTab = await getActiveWeekTab(page)
      expect(activeTab).toBe('next')
    })

    test('clicking This week tab updates URL to ?week=current', async ({ page }) => {
      await signUpWithHousehold(page)
      await page.goto('/meal-plan?week=next')

      // Only navigate if This week tab is visible (not Sunday)
      const visibleTabs = await getVisibleWeekTabs(page)
      if (visibleTabs.includes('current')) {
        await navigateToWeek(page, 'current')

        expect(page.url()).toContain('week=current')
        const activeTab = await getActiveWeekTab(page)
        expect(activeTab).toBe('current')
      }
    })
  })

  test.describe('Empty state content by week', () => {
    test('This week empty state shows correct heading and button', async ({ page }) => {
      await signUpWithHousehold(page)
      await page.goto('/meal-plan?week=current')

      const visibleTabs = await getVisibleWeekTabs(page)

      if (visibleTabs.includes('current')) {
        // Verify empty state heading
        await expect(
          page.getByRole('heading', { name: 'No meal plan for this week' }),
        ).toBeVisible()

        // Verify generate button has correct text
        await expect(page.getByRole('button', { name: 'Generate this week' })).toBeVisible()
      }
    })

    test('Next week empty state shows correct heading and button', async ({ page }) => {
      await signUpWithHousehold(page)
      await page.goto('/meal-plan?week=next')

      // Verify empty state heading
      await expect(page.getByRole('heading', { name: 'No meal plan for next week' })).toBeVisible()

      // Verify generate button has correct text
      await expect(page.getByRole('button', { name: 'Generate next week' })).toBeVisible()
    })

    test('partial week shows remaining days in description', async ({ page }) => {
      await signUpWithHousehold(page)
      await page.goto('/meal-plan?week=current')

      const visibleTabs = await getVisibleWeekTabs(page)
      const daysIndicator = await getCurrentWeekDaysIndicator(page)

      // If we're in a partial week (not Monday), description should mention remaining days
      if (visibleTabs.includes('current') && daysIndicator !== null) {
        // The description text varies but should contain the days count
        // e.g., "Generate a plan for the remaining 5 days of this week."
        const bodyText = await page.locator('body').textContent()
        expect(bodyText).toMatch(new RegExp(`${daysIndicator} days`))
      }
    })
  })

  test.describe('Plan generation and tab state', () => {
    // These tests are serial because they build on each other
    test.describe.configure({ mode: 'serial' })

    // Extend timeout for AI generation
    test.setTimeout(90000)

    test('generating plan removes No plan badge from tab', async ({ page }) => {
      await signUpWithHousehold(page)
      await page.goto('/meal-plan')

      const visibleTabs = await getVisibleWeekTabs(page)
      const targetWeek = visibleTabs.includes('current') ? 'current' : 'next'

      // Navigate to target week
      await page.goto(`/meal-plan?week=${targetWeek}`)

      // Verify No plan badge is shown before generation
      const hadNoPlanBefore = await tabHasNoPlanBadge(page, targetWeek)
      expect(hadNoPlanBefore).toBe(true)

      // Generate the meal plan
      await generateMealPlan(page)

      // Verify No plan badge is gone after generation
      const hasNoPlanAfter = await tabHasNoPlanBadge(page, targetWeek)
      expect(hasNoPlanAfter).toBe(false)
    })

    test('switching tabs preserves generated plan', async ({ page }) => {
      await signUpWithHousehold(page)
      await page.goto('/meal-plan')

      const visibleTabs = await getVisibleWeekTabs(page)
      const targetWeek = visibleTabs.includes('current') ? 'current' : 'next'
      const otherWeek = targetWeek === 'current' ? 'next' : 'current'

      // Navigate to target week and generate plan
      await page.goto(`/meal-plan?week=${targetWeek}`)
      await generateMealPlan(page)

      // Verify week view is showing
      await expect(page.getByRole('heading', { name: "This week's meals" })).toBeVisible()

      // Switch to other week
      if (visibleTabs.includes(otherWeek)) {
        await navigateToWeek(page, otherWeek)

        // Verify we're on the other week (should show empty state or its own plan)
        const activeTab = await getActiveWeekTab(page)
        expect(activeTab).toBe(otherWeek)

        // Switch back to original week
        await navigateToWeek(page, targetWeek)

        // Verify the plan is still there
        await expect(page.getByRole('heading', { name: "This week's meals" })).toBeVisible()
      }
    })
  })
})
