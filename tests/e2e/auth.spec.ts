import { test, expect } from '@playwright/test'
import {
  generateUniqueEmail,
  signUp,
  signIn,
  signOut,
  createHousehold,
  TEST_PASSWORD,
} from './utils/test-helpers'

test.describe('Authentication flows', () => {
  test('sign up -> onboarding -> create household -> view home', async ({ page }) => {
    const email = generateUniqueEmail()
    const name = 'New User'

    // Sign up
    await signUp(page, { email, name })

    // Should redirect to onboarding
    await expect(page).toHaveURL('/onboarding')
    await expect(page.getByRole('heading', { name: 'Create your household' })).toBeVisible()

    // Create household
    const householdName = `${name}'s Household`
    await page.getByLabel('Household name').clear()
    await page.getByLabel('Household name').fill(householdName)
    await page.getByRole('button', { name: 'Create household' }).click()

    // Should redirect to home with welcome message
    await expect(page).toHaveURL('/')
    await expect(page.getByText(`Welcome back, ${name}!`)).toBeVisible()
  })

  test('sign in -> view profile', async ({ page }) => {
    const email = generateUniqueEmail()
    const name = 'Existing User'

    // First sign up and complete onboarding
    await signUp(page, { email, name })
    await createHousehold(page)

    // Sign out to test sign in
    await signOut(page)
    await expect(page).toHaveURL('/')

    // Sign in
    await signIn(page, email)

    // Should redirect to profile (default returnUrl)
    await expect(page).toHaveURL('/profile')
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
    await expect(page.getByText(name)).toBeVisible()
  })

  test('sign out -> redirect to home with sign in link', async ({ page }) => {
    const email = generateUniqueEmail()

    // Sign up and complete onboarding
    await signUp(page, { email })
    await createHousehold(page)

    // Verify signed in state
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

    // Sign out
    await signOut(page)

    // Should be on home page with sign in option
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible()
  })

  test('sign in with invalid credentials shows error', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel('Email').fill('nonexistent@example.com')
    await page.getByLabel('Password').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Should show error message
    await expect(page.getByRole('alert')).toBeVisible()
  })
})
