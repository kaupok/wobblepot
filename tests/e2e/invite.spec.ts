import { test, expect } from '@playwright/test'
import {
  signUpWithHousehold,
  signUp,
  waitForDialog,
  createInvite,
} from './utils/test-helpers'

test.describe('Invite flows', () => {
  test('owner creates invite and sees invite link', async ({ page }) => {
    // Sign up as owner
    await signUpWithHousehold(page, { name: 'Owner' })

    // Navigate to invite settings
    await page.goto('/settings/invites')
    await expect(page.getByRole('heading', { name: 'Invite management' })).toBeVisible()

    // Click create invite
    await page.getByRole('button', { name: 'Create invite' }).click()

    // Wait for dialog to be visible and animation to complete
    await waitForDialog(page)
    await expect(page.getByText('Create invite link')).toBeVisible()

    // Submit with default values
    await page.getByRole('button', { name: 'Create invite' }).click()

    // Should show the created invite with URL
    await expect(page.getByText('Invite created')).toBeVisible()

    // Find the invite link input (readonly input in the dialog)
    const inviteInput = page.getByRole('dialog').locator('input[readonly]')
    await expect(inviteInput).toBeVisible()

    // Verify the invite URL format
    const inviteUrl = await inviteInput.inputValue()
    expect(inviteUrl).toContain('/invite/')
  })

  test('new user accepts invite and joins household', async ({ browser }) => {
    // Create two separate browser contexts to simulate two different users
    const ownerContext = await browser.newContext()
    const memberContext = await browser.newContext()

    try {
      const ownerPage = await ownerContext.newPage()
      const memberPage = await memberContext.newPage()

      // Step 1: Owner signs up and creates household
      await signUpWithHousehold(ownerPage, {
        name: 'Household Owner',
        householdName: 'Test Household',
      })

      // Step 2: Owner creates invite
      await ownerPage.goto('/settings/invites')
      await ownerPage.getByRole('button', { name: 'Create invite' }).click()
      await waitForDialog(ownerPage)
      await ownerPage.getByRole('button', { name: 'Create invite' }).click()
      await expect(ownerPage.getByText('Invite created')).toBeVisible()

      // Get the invite URL from readonly input in dialog
      const inviteInput = ownerPage.getByRole('dialog').locator('input[readonly]')
      const inviteUrl = await inviteInput.inputValue()
      const inviteCode = inviteUrl.split('/invite/')[1]

      // Step 3: New user signs up (without creating household)
      await signUp(memberPage, { name: 'New Member' })

      // New user should be redirected to onboarding
      await expect(memberPage).toHaveURL('/onboarding')

      // Step 4: Navigate to invite URL instead of completing onboarding
      await memberPage.goto(`/invite/${inviteCode}`)

      // Should see the join household card
      await expect(memberPage.getByRole('heading', { name: 'Join household' })).toBeVisible()
      await expect(memberPage.getByText('Test Household')).toBeVisible()

      // Step 5: Accept the invite
      await memberPage.getByRole('button', { name: 'Join household' }).click()

      // Should redirect to home page
      await expect(memberPage).toHaveURL('/')
      await expect(memberPage.getByText('Welcome back, New Member!')).toBeVisible()
    } finally {
      await ownerContext.close()
      await memberContext.close()
    }
  })

  test('expired invite shows error message', async ({ browser }) => {
    // Create two separate browser contexts
    const ownerContext = await browser.newContext()
    const member1Context = await browser.newContext()
    const member2Context = await browser.newContext()

    try {
      const ownerPage = await ownerContext.newPage()
      const member1Page = await member1Context.newPage()
      const member2Page = await member2Context.newPage()

      // Step 1: Owner signs up and creates household
      await signUpWithHousehold(ownerPage, {
        name: 'Owner',
        householdName: 'Limited Invite Household',
      })

      // Step 2: Create invite with max uses = 1
      await ownerPage.goto('/settings/invites')
      await ownerPage.getByRole('button', { name: 'Create invite' }).click()
      await waitForDialog(ownerPage)
      await ownerPage.getByLabel('Maximum uses').clear()
      await ownerPage.getByLabel('Maximum uses').fill('1')
      await ownerPage.getByRole('button', { name: 'Create invite' }).click()
      await expect(ownerPage.getByText('Invite created')).toBeVisible()

      // Get the invite URL from readonly input in dialog
      const inviteInput = ownerPage.getByRole('dialog').locator('input[readonly]')
      const inviteUrl = await inviteInput.inputValue()
      const inviteCode = inviteUrl.split('/invite/')[1]

      // Step 3: First member uses the invite
      await signUp(member1Page, { name: 'First Member' })
      await member1Page.goto(`/invite/${inviteCode}`)
      await member1Page.getByRole('button', { name: 'Join household' }).click()
      await expect(member1Page).toHaveURL('/')

      // Step 4: Second user tries to use the same invite
      await signUp(member2Page, { name: 'Second Member' })
      await member2Page.goto(`/invite/${inviteCode}`)

      // Should see expired/invalid message
      await expect(member2Page.getByRole('heading', { name: 'Invite expired' })).toBeVisible()
      await expect(
        member2Page.getByText('This invite link has expired or reached its maximum number of uses'),
      ).toBeVisible()
    } finally {
      await ownerContext.close()
      await member1Context.close()
      await member2Context.close()
    }
  })

  test('user already in household sees appropriate message', async ({ browser }) => {
    const ownerContext = await browser.newContext()
    const owner2Context = await browser.newContext()

    try {
      const owner1Page = await ownerContext.newPage()
      const owner2Page = await owner2Context.newPage()

      // Create first household with invite
      await signUpWithHousehold(owner1Page, {
        name: 'Owner One',
        householdName: 'First Household',
      })
      await owner1Page.goto('/settings/invites')
      await owner1Page.getByRole('button', { name: 'Create invite' }).click()
      await waitForDialog(owner1Page)
      await owner1Page.getByRole('button', { name: 'Create invite' }).click()
      await expect(owner1Page.getByText('Invite created')).toBeVisible()
      const inviteInput = owner1Page.getByRole('dialog').locator('input[readonly]')
      const inviteUrl = await inviteInput.inputValue()
      const inviteCode = inviteUrl.split('/invite/')[1]

      // Create second user with their own household
      await signUpWithHousehold(owner2Page, {
        name: 'Owner Two',
        householdName: 'Second Household',
      })

      // Second user tries to use first user's invite
      await owner2Page.goto(`/invite/${inviteCode}`)

      // Should see "already a member" message
      await expect(owner2Page.getByRole('heading', { name: 'Already a member' })).toBeVisible()
      await expect(owner2Page.getByText('Second Household')).toBeVisible()
    } finally {
      await ownerContext.close()
      await owner2Context.close()
    }
  })

  test('owner revokes invite before it is used', async ({ browser }) => {
    const ownerContext = await browser.newContext()
    const memberContext = await browser.newContext()

    try {
      const ownerPage = await ownerContext.newPage()
      const memberPage = await memberContext.newPage()

      // Owner creates household and invite
      await signUpWithHousehold(ownerPage, {
        name: 'Owner',
        householdName: 'Revoke Test Household',
      })
      const inviteCode = await createInvite(ownerPage)

      // Owner closes the success dialog and revokes the invite
      await ownerPage.getByRole('button', { name: 'Close' }).click()

      // Set up dialog handler for the confirm() prompt
      ownerPage.on('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm')
        await dialog.accept()
      })

      // Click revoke button
      await ownerPage.getByRole('button', { name: 'Revoke' }).click()

      // Wait for invite to be removed from the list
      await expect(ownerPage.getByRole('button', { name: 'Revoke' })).not.toBeVisible()

      // New user tries to use the revoked invite
      await signUp(memberPage, { name: 'New Member' })
      await memberPage.goto(`/invite/${inviteCode}`)

      // Revoked invites are deleted from DB, so the page returns 404
      await expect(memberPage.getByText('404')).toBeVisible()
      await expect(memberPage.getByText('This page could not be found')).toBeVisible()
    } finally {
      await ownerContext.close()
      await memberContext.close()
    }
  })

  test('clipboard copy works correctly', async ({ browser }) => {
    // Create context with clipboard permissions
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    })

    try {
      const page = await context.newPage()

      // Create household and invite
      await signUpWithHousehold(page, { name: 'Owner' })
      await page.goto('/settings/invites')
      await page.getByRole('button', { name: 'Create invite' }).click()
      await waitForDialog(page)
      await page.getByRole('button', { name: 'Create invite' }).click()
      await expect(page.getByText('Invite created')).toBeVisible()

      // Get the expected invite URL
      const inviteInput = page.getByRole('dialog').locator('input[readonly]')
      const expectedUrl = await inviteInput.inputValue()

      // Close the dialog to see the invite card with Copy button
      await page.getByRole('button', { name: 'Close' }).click()

      // Click Copy button on the invite card
      await page.getByRole('button', { name: 'Copy' }).click()

      // Verify button text changes to "Copied!"
      await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible()

      // Verify clipboard content matches
      const clipboardContent = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardContent).toBe(expectedUrl)
    } finally {
      await context.close()
    }
  })

  test('multiple pending invites are displayed', async ({ page }) => {
    // Create household
    await signUpWithHousehold(page, { name: 'Owner' })

    // Create first invite with max uses = 5
    await createInvite(page, { maxUses: 5 })
    await page.getByRole('button', { name: 'Close' }).click()

    // Create second invite with max uses = 10
    await createInvite(page, { maxUses: 10 })
    await page.getByRole('button', { name: 'Close' }).click()

    // Verify both invites appear in the active invites list
    await expect(page.getByText('Active invites')).toBeVisible()

    // Should see two invite cards with different usage limits
    await expect(page.getByText('0/5 uses')).toBeVisible()
    await expect(page.getByText('0/10 uses')).toBeVisible()

    // Should have two Revoke buttons (one for each invite)
    await expect(page.getByRole('button', { name: 'Revoke' })).toHaveCount(2)
  })
})
