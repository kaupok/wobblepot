import 'server-only'

import { APIError } from 'better-auth/api'
import { nanoid } from 'nanoid'

import { type FlagKey, getServerFlag } from '@/lib/feature-flags'
import {
  findHouseholdInvite,
  getHouseholdInviteCodeFromBody,
  getInviteValidity,
} from '@/lib/household-invite'
import { prisma, type PrismaClientType } from '@/lib/prisma'

export const INVITE_CODE_REQUIRED_MESSAGE = 'An invite code is required.'
export const INVITE_CODE_INVALID_MESSAGE = 'This invite code is invalid, expired, or already used.'
/**
 * Its own message, not {@link INVITE_CODE_INVALID_MESSAGE}: the sign-up form
 * maps it to its own catalog copy (`getAuthErrorKey` matches "household
 * invite"), which tells the visitor to ask the household owner for a new link.
 */
export const HOUSEHOLD_INVITE_INVALID_MESSAGE =
  'This household invite link is invalid, expired, or already used.'

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

/** An unused code whose expiry, if any, is still ahead. */
function claimableCodeWhere(code: string) {
  return {
    code,
    usedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  }
}

/**
 * Checks the household invite on the body (HON-1131). Returns `true` when the
 * body carries one and it is claimable now, throws when it carries one that is
 * not, and returns `false` when it carries none.
 */
async function checkHouseholdInvite(body: unknown, db: PrismaClientType): Promise<boolean> {
  const householdCode = getHouseholdInviteCodeFromBody(body)
  if (!householdCode) return false
  const invite = await findHouseholdInvite(householdCode, db)
  if (!invite || getInviteValidity(invite) !== 'valid') {
    throw new APIError('FORBIDDEN', { message: HOUSEHOLD_INVITE_INVALID_MESSAGE })
  }
  return true
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
 * A household invite stands in for the sign-up code (HON-1131): the owner is
 * vouching for the invitee. With `householdInviteCode` on the body, the
 * request passes only if that invite is claimable now (`getInviteValidity`,
 * the same checks the join route makes), and no `SignupCode` is claimed. The
 * invite is not claimed here, because no user exists yet; the after-hook
 * claims it (`afterEmailSignUp` in `src/lib/auth.ts`). Each link still admits
 * one account: the claim deletes the invite, so a second sign-up on the same
 * link finds no invite and is refused here.
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
  if (await checkHouseholdInvite(body, db)) return

  const code = getInviteCodeFromBody(body)
  if (!code) {
    throw new APIError('FORBIDDEN', { message: INVITE_CODE_REQUIRED_MESSAGE })
  }

  if (!(await claimInviteCode(body, { db }))) {
    throw new APIError('FORBIDDEN', { message: INVITE_CODE_INVALID_MESSAGE })
  }
}

/**
 * The same gate as {@link validateAndClaimInviteCode}, with no write: the code
 * must be claimable now, and nothing marks it used. Google sign-up (HON-1157)
 * runs this before the redirect to Google, because the user can abandon the
 * flow there and a claimed code would be burnt. {@link claimInviteCode} claims
 * it once the user row exists.
 */
export async function validateInviteCode(
  body: unknown,
  options: SignupCodeOptions = {},
): Promise<void> {
  const db = options.db ?? prisma
  const getFlag = options.getFlag ?? getServerFlag

  if (!(await getFlag(INVITE_FLAG, 'anonymous'))) return
  if (await checkHouseholdInvite(body, db)) return

  const code = getInviteCodeFromBody(body)
  if (!code) {
    throw new APIError('FORBIDDEN', { message: INVITE_CODE_REQUIRED_MESSAGE })
  }

  const claimable = await db.signupCode.findFirst({
    where: claimableCodeWhere(code),
    select: { id: true },
  })
  if (!claimable) {
    throw new APIError('FORBIDDEN', { message: INVITE_CODE_INVALID_MESSAGE })
  }
}

/**
 * Atomically marks the body's code used, and says whether this call won.
 * `false` when the body has no code, or the code is used, expired or gone: a
 * concurrent sign-up with the same code claimed it first.
 */
export async function claimInviteCode(
  body: unknown,
  options: Pick<SignupCodeOptions, 'db'> = {},
): Promise<boolean> {
  const db = options.db ?? prisma
  const code = getInviteCodeFromBody(body)
  if (!code) return false

  const claimed = await db.signupCode.updateMany({
    where: claimableCodeWhere(code),
    data: { usedAt: new Date() },
  })
  return claimed.count > 0
}

/**
 * Best-effort backfill of `usedById` after the user row has been created,
 * then deletion of the waitlist request the code was sent to, if any. The
 * request under the user's email is `clearWaitlistForNewUser`'s (HON-1102).
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
      return
    }
  } catch (err) {
    console.warn('[signup-code] failed to link usedById', { code, userId, err })
    return
  }

  // A waitlist request whose invite code was just used has done its job:
  // delete it now rather than at the end of its retention (HON-970, the
  // "earlier when the code is used" promise in the privacy policy). The
  // request under the new user's email (a Send again that moved the link to a
  // new code, or a waitlist person who signed up with some other code) is
  // `clearWaitlistForNewUser`'s, which the sign-up hook runs after this.
  try {
    await db.waitlistRequest.deleteMany({ where: { signupCode: { code } } })
  } catch (err) {
    console.warn('[signup-code] failed to delete the waitlist request for a used code', {
      code,
      err,
    })
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

/**
 * A code as `/admin/signup-codes` and its API send it to the client. The page
 * and the route both read it from here, so a refetch through `useQuery` shows
 * the same "Used by" as the first render.
 */
export interface SignupCodeRow {
  id: string
  code: string
  createdAt: string
  usedAt: string | null
  expiresAt: string | null
  note: string | null
  usedByEmail: string | null
}

const CODE_SELECT = {
  id: true,
  code: true,
  createdAt: true,
  usedAt: true,
  expiresAt: true,
  note: true,
  usedBy: { select: { email: true } },
} as const

function toSignupCodeRow(row: {
  id: string
  code: string
  createdAt: Date
  usedAt: Date | null
  expiresAt: Date | null
  note: string | null
  usedBy: { email: string } | null
}): SignupCodeRow {
  return {
    id: row.id,
    code: row.code,
    createdAt: row.createdAt.toISOString(),
    usedAt: row.usedAt ? row.usedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    note: row.note,
    usedByEmail: row.usedBy?.email ?? null,
  }
}

/**
 * Why `revokeSignupCode` was refused. The route maps each one to its status:
 *
 * - `notFound`: no code with this id (404).
 * - `alreadyUsed`: the code was claimed, so it is an audit record (409).
 */
export type SignupCodeRefusal = 'notFound' | 'alreadyUsed'

export class SignupCodeError extends Error {
  constructor(readonly reason: SignupCodeRefusal) {
    super(`Signup code change refused: ${reason}`)
    this.name = 'SignupCodeError'
  }
}

/** The newest 100 codes, newest first, for `/admin/signup-codes`. */
export async function listSignupCodes(): Promise<SignupCodeRow[]> {
  const rows = await prisma.signupCode.findMany({
    take: 100,
    orderBy: { createdAt: 'desc' },
    select: CODE_SELECT,
  })
  return rows.map(toSignupCodeRow)
}

/** Mints a single-use code with no expiry, as Mint on `/admin/signup-codes` does. */
export async function createSignupCode({
  createdById,
  note,
}: {
  createdById: string
  note: string | null
}): Promise<SignupCodeRow> {
  const created = await prisma.signupCode.create({
    data: { code: nanoid(12), createdById, note },
    select: CODE_SELECT,
  })
  return toSignupCodeRow(created)
}

/** Deletes an unused code. A claimed code is an audit record and stays. */
export async function revokeSignupCode(id: string): Promise<void> {
  // deleteMany combines the predicate without a SELECT first.
  const { count } = await prisma.signupCode.deleteMany({ where: { id, usedAt: null } })
  if (count > 0) return

  // Either the code does not exist or it was claimed. The admin needs the
  // difference, so the client can suggest a reload.
  const existing = await prisma.signupCode.findUnique({ where: { id }, select: { id: true } })
  throw new SignupCodeError(existing ? 'alreadyUsed' : 'notFound')
}

/**
 * Mints a code for an E2E test through `/api/e2e-seed`. The `e2e-` prefix
 * tells these rows apart from real invites.
 */
export async function mintE2eSignupCode(): Promise<string> {
  const code = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  await prisma.signupCode.create({ data: { code } })
  return code
}

/**
 * Deletes the code with this value if it is unused, and returns how many rows
 * went. A claimed code is an audit record even in test, so a helper that
 * targets a real attribution row stays a no-op.
 */
export async function deleteUnusedSignupCode(code: string): Promise<number> {
  const { count } = await prisma.signupCode.deleteMany({ where: { code, usedAt: null } })
  return count
}
