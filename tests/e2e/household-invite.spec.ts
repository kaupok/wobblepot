// ROUTES: /household, /invite/[code] · COMPONENTS: AddMemberDialog, MemberInviteDialog, JoinHouseholdCard
import { test, expect, type Page } from '@playwright/test'
import { generateUniqueEmail, signUp, signUpWithHousehold } from './utils/test-helpers'

/**
 * Household member-invite flow (HON-667).
 *
 * Restores the coverage HON-518 removed when it deleted the drifted
 * `invite.spec.ts`. Invites are per **manual member**, not per household: the
 * owner adds a member with no linked account, mints a link from that member's
 * card, and the invitee claims that exact member row — `POST
 * /api/invites/[code]/join` sets `HouseholdMember.userId` on the existing row
 * and deletes the invite, rather than creating a second member.
 *
 * Not `@smoke`: it signs up two accounts, and account creation needs an invite
 * code from `/api/e2e-seed`, which 404s on preview and staging by design
 * (HON-560). Not `@ai` either — no Claude call anywhere in the flow. So it runs
 * in tier 1 CI and `pnpm test:e2e:local` only.
 */
test.describe('Household member invite', () => {
  // Two full sign-ups (HIBP + scrypt + Neon, serialized per account) plus
  // onboarding in a single test — the 60s CI default is not enough. Same
  // reasoning as account-deletion.spec.ts and pantry-deduction.spec.ts, which
  // budget 90s for one sign-up each.
  test.setTimeout(120_000)

  const OWNER_NAME = 'Invite Owner'
  const INVITEE_NAME = 'Invited Partner'
  const MANUAL_MEMBER_NAME = 'Kiddo'

  /**
   * A member-card status badge. `exact` is what makes this safe to assert
   * `toHaveCount(0)` on: the substring default would also match the badge text
   * inside longer copy elsewhere on the page.
   */
  const badge = (page: Page, text: string) => page.getByText(text, { exact: true })

  test('owner mints an invite for a manual member; invitee joins and claims the profile', async ({
    page,
    browser,
  }) => {
    const householdName = `Invite Household ${Date.now()}`

    // --- 1. Owner: sign up, create the household, add a manual member -------
    await signUpWithHousehold(page, {
      name: OWNER_NAME,
      email: generateUniqueEmail(),
      householdName,
    })

    await page.goto('/household')
    await expect(page.getByRole('heading', { name: 'Household', level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'Add member' }).click()
    const addDialog = page.getByRole('dialog')
    await expect(addDialog).toBeVisible()
    // `exact` matters: the default substring match also hits "Display name
    // (optional)", which would be a strict-mode violation.
    await addDialog.getByLabel('Name', { exact: true }).fill(MANUAL_MEMBER_NAME)
    // Scoped to the dialog because the page-level trigger shares this
    // accessible name and stays mounted while the dialog is open.
    await addDialog.getByRole('button', { name: 'Add member' }).click()
    await expect(addDialog).toBeHidden()

    // A manual member carries the "Manual" badge until an invite exists.
    await expect(page.getByText(MANUAL_MEMBER_NAME)).toBeVisible()
    await expect(badge(page, 'Manual')).toBeVisible()

    // --- 2. Owner: mint the invite link ------------------------------------
    // The mail button only renders for members with `userId === null`, so this
    // is unambiguous: the owner's own card has a linked account.
    await page.getByRole('button', { name: 'Invite to join' }).click()
    const inviteDialog = page.getByRole('dialog')
    await expect(
      inviteDialog.getByRole('heading', { name: `Invite ${MANUAL_MEMBER_NAME}` }),
    ).toBeVisible()

    await inviteDialog.getByRole('button', { name: 'Create invite link' }).click()

    // Read the link out of the DOM, never the clipboard: clipboard permissions
    // are flaky across Playwright projects, and the active-invite branch
    // renders the URL into a readonly input anyway.
    const linkInput = inviteDialog.getByLabel('Invite link')
    await expect(linkInput).toBeVisible()
    await expect(linkInput).toHaveValue(/\/invite\/[\w-]+$/)
    const inviteUrl = await linkInput.inputValue()
    expect(inviteUrl).toMatch(/^https?:\/\/.+\/invite\/[\w-]+$/)

    // Navigate by pathname, not by the absolute URL. The server builds that URL
    // from `getServerBaseURL()` (i.e. `NEXT_PUBLIC_APP_URL`), which is app
    // config rather than the request origin — it matches Playwright's `baseURL`
    // in CI and under `pnpm test:e2e:local` today, but the spec should not
    // break if the two ever diverge.
    const invitePath = new URL(inviteUrl).pathname

    await inviteDialog.getByRole('button', { name: 'Done' }).click()
    await expect(inviteDialog).toBeHidden()
    // The roster refetches after the invite is created.
    await expect(badge(page, 'Invite pending')).toBeVisible()

    // --- 3. Invitee: separate context, no household of their own -----------
    const inviteeContext = await browser.newContext()
    try {
      const inviteePage = await inviteeContext.newPage()
      await signUp(inviteePage, { name: INVITEE_NAME, email: generateUniqueEmail() })

      await inviteePage.goto(invitePath)
      await expect(
        inviteePage.getByRole('heading', { name: `Join as ${MANUAL_MEMBER_NAME}` }),
      ).toBeVisible()
      await expect(inviteePage.getByText(householdName)).toBeVisible()

      await inviteePage.getByRole('button', { name: `Join as ${MANUAL_MEMBER_NAME}` }).click()
      await expect(inviteePage).toHaveURL('/')

      // --- 4. Owner's view: the member is claimed, badges are gone ---------
      await page.reload()
      // MemberCard resolves the linked account's name ahead of the manual
      // `member.name`, so the invitee's account name appearing here IS the
      // assertion that the row was claimed rather than duplicated.
      await expect(page.getByText(INVITEE_NAME)).toBeVisible()
      // Keep this assertion after the one above: the roster is a client-side
      // useQuery, so both badge counts are also 0 while the skeleton is on
      // screen. Waiting for the claimed card first is what gives the count-0
      // assertions something to be true *about*.
      await expect(badge(page, 'Manual')).toHaveCount(0)
      await expect(badge(page, 'Invite pending')).toHaveCount(0)

      // --- 5. Invitee's view: same household, both members -----------------
      await inviteePage.goto('/household')
      // Read-only for a non-owner, but populated — the value is the assertion
      // that this is the owner's household, not a second one.
      await expect(inviteePage.getByLabel('Household name')).toHaveValue(householdName)
      await expect(inviteePage.getByText(OWNER_NAME)).toBeVisible()
      await expect(inviteePage.getByText(INVITEE_NAME)).toBeVisible()
    } finally {
      await inviteeContext.close()
    }
  })
})
