import 'server-only'
import { APIError } from 'better-auth/api'
import { prisma, type PrismaClientType } from '@/lib/prisma'
import { getServerFlag, type FlagKey } from '@/lib/feature-flags'

export const INVITE_CODE_REQUIRED_MESSAGE = 'An invite code is required.'
export const INVITE_CODE_INVALID_MESSAGE = 'This invite code is invalid, expired, or already used.'

const INVITE_FLAG: FlagKey = 'invite_code_required'

interface SignupCodeOptions {
  db?: PrismaClientType
  getFlag?: (key: FlagKey, distinctId: string) => Promise<boolean>
}

/** Pull `inviteCode` off an unknown body, normalising trims and non-strings. */
export function getInviteCodeFromBody(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''
  const raw = (body as { inviteCode?: unknown }).inviteCode
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * Validates the invite code on the sign-up request and atomically claims it.
 *
 * Short-circuits if the `invite_code_required` flag is `false` — that opens
 * sign-up to the public without a deploy. Otherwise the code is required and
 * the row-level UPDATE only succeeds when the code is currently unused and
 * unexpired. Postgres serializes concurrent updates on the same row, so
 * exactly one concurrent caller wins.
 *
 * Throws `APIError('FORBIDDEN', ...)` when the gate rejects the request —
 * Better Auth converts that into a 403 response.
 */
export async function validateAndClaimInviteCode(
  body: unknown,
  options: SignupCodeOptions = {},
): Promise<void> {
  const db = options.db ?? prisma
  const getFlag = options.getFlag ?? getServerFlag

  if (!(await getFlag(INVITE_FLAG, 'anonymous'))) return

  const code = getInviteCodeFromBody(body)
  if (!code) {
    throw new APIError('FORBIDDEN', { message: INVITE_CODE_REQUIRED_MESSAGE })
  }

  const claimed = await db.signupCode.updateMany({
    where: {
      code,
      usedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    data: { usedAt: new Date() },
  })

  if (claimed.count === 0) {
    throw new APIError('FORBIDDEN', { message: INVITE_CODE_INVALID_MESSAGE })
  }
}

/**
 * Best-effort backfill of `usedById` after the user row has been created.
 * The atomic claim already happened in {@link validateAndClaimInviteCode};
 * failing here doesn't fail sign-up — admin can backfill from logs if needed.
 */
export async function linkUsedBy(
  body: unknown,
  userId: string,
  options: Pick<SignupCodeOptions, 'db'> = {},
): Promise<void> {
  const db = options.db ?? prisma
  const code = getInviteCodeFromBody(body)
  if (!code) return

  try {
    const result = await db.signupCode.updateMany({
      where: { code, usedById: null },
      data: { usedById: userId },
    })
    if (result.count === 0) {
      // Either someone else linked first (impossible in normal flow given the
      // atomic claim) or the row vanished. Either way, the failure is the
      // exact case admins want to know about — log enough to recover.
      console.warn('[signup-code] linkUsedBy matched zero rows', { code, userId })
    }
  } catch (err) {
    console.warn('[signup-code] failed to link usedById', { code, userId, err })
  }
}

/**
 * Release a previously-claimed code so it can be used again. Called from the
 * after-hook when sign-up fails *after* the atomic claim — without this, the
 * user hits a friendly error (HIBP-breached password, duplicate email, etc.)
 * but their invite code is permanently burned with no user attached.
 *
 * The `usedById: null` predicate is the safety belt: if Better Auth somehow
 * ran the after-hook twice and the first run already linked the code, we
 * MUST NOT roll the claim back. Only release codes that were claimed but
 * never linked.
 */
export async function releaseClaim(
  body: unknown,
  options: Pick<SignupCodeOptions, 'db'> = {},
): Promise<void> {
  const db = options.db ?? prisma
  const code = getInviteCodeFromBody(body)
  if (!code) return

  try {
    const result = await db.signupCode.updateMany({
      where: { code, usedById: null, usedAt: { not: null } },
      data: { usedAt: null },
    })
    if (result.count > 0) {
      console.warn('[signup-code] released unlinked claim after sign-up failure', { code })
    }
  } catch (err) {
    console.warn('[signup-code] failed to release claim', { code, err })
  }
}
