/**
 * Household invite codes are `nanoid(12)` (`POST /api/households/me/invites`).
 * The pattern is looser than that, so a future length change keeps working,
 * but it still rejects anything that is not a code before it reaches the
 * database or a URL.
 */
const HOUSEHOLD_INVITE_CODE_PATTERN = /^[\w-]{1,64}$/

const INVITE_PATH_PATTERN = /^\/invite\/([\w-]{1,64})$/

/**
 * The household invite code a sign-up visit carries, or `null` (HON-1131).
 *
 * Two ways in: `?invite=<code>` from the invite page's Create account link,
 * and `?returnUrl=/invite/<code>` from Sign in's footer link to Sign up, which
 * a visitor reaches when they took the invite page's Sign in action first.
 * `invite` wins when both are present.
 *
 * Pure, so the sign-up page and its tests share one parser.
 */
export function getHouseholdInviteCodeFromParams(params: {
  invite?: string | null
  returnUrl?: string | null
}): string | null {
  const invite = params.invite?.trim()
  if (invite && HOUSEHOLD_INVITE_CODE_PATTERN.test(invite)) return invite

  const match = params.returnUrl?.trim().match(INVITE_PATH_PATTERN)
  return match?.[1] ?? null
}

/** The invite page for a code, the path both auth pages send an invitee back to. */
export function householdInvitePath(code: string): string {
  return `/invite/${encodeURIComponent(code)}`
}
