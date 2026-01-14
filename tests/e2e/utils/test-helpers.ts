import { expect, type Page } from '@playwright/test'

/**
 * Default test password that meets the 8+ character requirement
 */
export const TEST_PASSWORD = 'testpass123'

/**
 * Default test user name
 */
export const TEST_NAME = 'Test User'

/**
 * Generates a unique email address for test isolation
 * Format: test-{timestamp}-{random}@example.com
 */
export function generateUniqueEmail(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `test-${timestamp}-${random}@example.com`
}

/**
 * Signs up a new user via the UI
 * Waits for redirect away from sign-up page
 */
export async function signUp(
  page: Page,
  options: { name?: string; email?: string; password?: string } = {},
): Promise<{ email: string; password: string; name: string }> {
  const email = options.email ?? generateUniqueEmail()
  const password = options.password ?? TEST_PASSWORD
  const name = options.name ?? TEST_NAME

  await page.goto('/sign-up')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign up' }).click()

  // Wait for navigation away from sign-up page
  await page.waitForURL((url) => !url.pathname.includes('/sign-up'))

  return { email, password, name }
}

/**
 * Creates a household during onboarding
 */
export async function createHousehold(page: Page, householdName?: string): Promise<void> {
  await page.waitForURL('/onboarding')

  if (householdName) {
    await page.getByLabel('Household name').clear()
    await page.getByLabel('Household name').fill(householdName)
  }

  await page.getByRole('button', { name: 'Create household' }).click()
  await page.waitForURL('/')
}

/**
 * Signs in an existing user via the UI
 * Waits for redirect away from sign-in page
 */
export async function signIn(
  page: Page,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Wait for navigation away from sign-in page
  await page.waitForURL((url) => !url.pathname.includes('/sign-in'))
}

/**
 * Signs out the current user via the header button
 * Waits for redirect to home page
 */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL('/')
}

/**
 * Waits for a dialog to be visible and animation to complete
 * Radix dialogs transition to data-state="open" when fully visible
 */
export async function waitForDialog(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('data-state', 'open')
}

/**
 * Creates an invite and returns the invite code
 * Must be called when signed in as a household owner
 */
export async function createInvite(
  page: Page,
  options: { maxUses?: number } = {},
): Promise<string> {
  await page.goto('/settings/invites')
  await page.getByRole('button', { name: 'Create invite' }).click()
  await waitForDialog(page)

  if (options.maxUses !== undefined) {
    await page.getByLabel('Maximum uses').clear()
    await page.getByLabel('Maximum uses').fill(String(options.maxUses))
  }

  await page.getByRole('button', { name: 'Create invite' }).click()
  await expect(page.getByText('Invite created')).toBeVisible()

  const inviteInput = page.getByRole('dialog').locator('input[readonly]')
  const inviteUrl = await inviteInput.inputValue()
  const inviteCode = inviteUrl.split('/invite/')[1]
  if (!inviteCode) {
    throw new Error(`Failed to extract invite code from URL: ${inviteUrl}`)
  }
  return inviteCode
}

/**
 * Complete sign up and onboarding flow
 * Returns the user credentials
 */
export async function signUpWithHousehold(
  page: Page,
  options: { name?: string; email?: string; householdName?: string } = {},
): Promise<{ email: string; password: string; name: string }> {
  const credentials = await signUp(page, options)
  await createHousehold(page, options.householdName)
  return credentials
}

// ==========================================
// Meal Plan Helpers
// ==========================================

export type MealStatus = 'planned' | 'completed' | 'skipped' | 'eating_out' | 'leftovers'

/**
 * Generates a meal plan from the empty state
 * Clicks the generate button and waits for the week view to appear
 */
export async function generateMealPlan(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Generate meal plan' }).click()

  // Wait for week view heading to appear (generation complete)
  await expect(page.getByRole('heading', { name: "This week's meals" })).toBeVisible({
    timeout: 60000,
  })
}

/**
 * Gets a meal card by index (0-based)
 * Returns the first card if no index specified
 */
export function getMealCard(page: Page, index: number = 0) {
  // Meal cards are the Card components within the week view grid
  // Each card has a title, status select, and View/Swap buttons
  return page.locator('[data-slot="card"]').filter({ hasText: 'View' }).nth(index)
}

/**
 * Opens the meal detail modal by clicking View on a meal card
 */
export async function openMealDetail(
  page: Page,
  mealCard: ReturnType<typeof getMealCard>,
): Promise<void> {
  await mealCard.getByRole('button', { name: 'View' }).click()
  await waitForDialog(page)
}

/**
 * Changes the status of a meal via the status dropdown
 */
export async function changeMealStatus(
  page: Page,
  mealCard: ReturnType<typeof getMealCard>,
  status: MealStatus,
): Promise<void> {
  // Click the status select trigger within the card
  const statusTrigger = mealCard.locator('button[role="combobox"]')
  await statusTrigger.click()

  // Wait for dropdown to appear and select the status
  const statusLabels: Record<MealStatus, string> = {
    planned: 'Planned',
    completed: 'Completed',
    skipped: 'Skipped',
    eating_out: 'Eating out',
    leftovers: 'Leftovers',
  }
  await page.getByRole('option', { name: statusLabels[status] }).click()
}

/**
 * Opens the swap modal (RegenerateModal) by clicking Swap on a meal card
 */
export async function openSwapModal(
  page: Page,
  mealCard: ReturnType<typeof getMealCard>,
): Promise<void> {
  await mealCard.getByRole('button', { name: 'Swap' }).click()
  await waitForDialog(page)
}
