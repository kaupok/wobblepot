import type { Page } from '@playwright/test'

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
 */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click()
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
