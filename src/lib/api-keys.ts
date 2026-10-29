import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

import { Prisma } from '@/generated/prisma/client'
import { getPosthogServer } from '@/lib/posthog-server'
import { prisma } from '@/lib/prisma'
import { sanitizeEventProperties } from '@/lib/redact'

/**
 * Read-only API keys for screens and scripts (HON-1220). A member makes one on
 * `/account/connections`, optionally with an expiry, and the household's owner sees and
 * revokes every member's keys there (HON-1221). `GET /api/v1/meal-plan` and
 * `GET /api/v1/shopping-list` accept a key as `Authorization: Bearer wp_…`
 * (`src/lib/api/v1/caller.ts`).
 *
 * Only those two routes read a key. No proxy or Better Auth hook does, so
 * `auth.api.getSession` never turns a key into a session and a key sent to any
 * other route is ignored. Only the SHA-256 hash is stored: the key is 32
 * random characters, so a fast hash is enough, and the lookup is by hash, so no
 * timing-safe compare is needed. See docs/API.md and docs/SECURITY.md.
 */

export const API_KEY_PREFIX = 'wp_'
const RANDOM_LENGTH = 32
/** Random characters shown after the prefix in the list, so a member can tell keys apart. */
const START_RANDOM_LENGTH = 6
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export const MAX_API_KEYS_PER_USER = 10
export const MAX_API_KEY_NAME_LENGTH = 60
/** "Expires in (optional)" takes 1 to this many days (HON-1221). */
export const MAX_API_KEY_EXPIRY_DAYS = 365

/** The whole key, as a header carries it. Anything else is refused before a lookup. */
export const API_KEY_PATTERN = /^wp_[A-Za-z0-9]{32}$/

export const API_KEY_CREATED_EVENT = 'api_key:created'
export const API_KEY_REVOKED_EVENT = 'api_key:revoked'

const DAY_MS = 24 * 60 * 60 * 1000

/** One key, as `GET /api/auth/user/api-keys` returns it. Never the key or its hash. */
export interface ApiKeySummary {
  id: string
  name: string
  /** `wp_` plus the first 6 random characters. */
  start: string
  /** ISO timestamp. */
  createdAt: string
  /** ISO timestamp, or null for a key that was never used. */
  lastUsedAt: string | null
  /** ISO timestamp, or null for a key that does not expire. */
  expiresAt: string | null
  /**
   * True once `expiresAt` is past. Set by the server, so the server and the
   * browser render the same row.
   */
  expired: boolean
  /** The member the key belongs to, in the owner's household view; null in a member's own list. */
  memberName: string | null
}

/**
 * Whose keys a signed-in user sees and may revoke (HON-1221). A household's
 * owner has `householdId` set and sees every member's keys; anyone else has
 * null and sees their own only.
 */
export interface ApiKeyViewer {
  userId: string
  householdId: string | null
}

/**
 * The viewer for a user: the household id only when the user is its owner.
 * Two fields from the member row, so the routes do not load the household.
 */
export async function getApiKeyViewer(userId: string): Promise<ApiKeyViewer> {
  const member = await prisma.householdMember.findUnique({
    where: { userId },
    select: { householdId: true, role: true },
  })
  return { userId, householdId: member?.role === 'owner' ? member.householdId : null }
}

/** The keys a viewer may see and revoke. */
function viewerScope(viewer: ApiKeyViewer): Prisma.ApiKeyWhereInput {
  return viewer.householdId
    ? { user: { householdMembership: { householdId: viewer.householdId } } }
    : { userId: viewer.userId }
}

/**
 * A new key: `wp_` and 32 characters from `[A-Za-z0-9]`. A byte of 248 or more
 * is dropped, so every character is equally likely (248 = 4 × 62).
 */
export function generateApiKey(): string {
  let random = ''
  while (random.length < RANDOM_LENGTH) {
    for (const byte of randomBytes(RANDOM_LENGTH * 2)) {
      if (byte >= 248) continue
      random += ALPHABET[byte % ALPHABET.length]
      if (random.length === RANDOM_LENGTH) break
    }
  }
  return API_KEY_PREFIX + random
}

/** Hex SHA-256 of the whole key, prefix included: the stored lookup value. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function apiKeyStart(key: string): string {
  return key.slice(0, API_KEY_PREFIX.length + START_RANDOM_LENGTH)
}

const SUMMARY_SELECT = {
  id: true,
  name: true,
  start: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
} as const

function toSummary(
  row: {
    id: string
    name: string
    start: string
    createdAt: Date
    lastUsedAt: Date | null
    expiresAt: Date | null
  },
  memberName: string | null = null,
  now = new Date(),
): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    start: row.start,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    expired: row.expiresAt !== null && row.expiresAt <= now,
    memberName,
  }
}

/**
 * The keys the viewer sees, oldest first: an owner's household view has every
 * member's keys with the member's name, anyone else's list has their own.
 */
export async function listApiKeys(viewer: ApiKeyViewer): Promise<ApiKeySummary[]> {
  const rows = await prisma.apiKey.findMany({
    where: viewerScope(viewer),
    select: {
      ...SUMMARY_SELECT,
      user: {
        select: {
          name: true,
          householdMembership: {
            select: { name: true, preferences: { select: { displayName: true } } },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  const now = new Date()
  return rows.map(({ user, ...row }) =>
    toSummary(
      row,
      viewer.householdId
        ? // The fallback `MemberRow` uses for the members list.
          user.householdMembership?.preferences?.displayName ||
            user.name ||
            user.householdMembership?.name ||
            null
        : null,
      now,
    ),
  )
}

export type CreateApiKeyResult =
  { status: 'created'; key: string; apiKey: ApiKeySummary } | { status: 'limit_reached' }

/**
 * Makes a key for the user and returns it in plain text. This is the only time
 * the key exists outside the caller's device: the row keeps its hash.
 *
 * Refuses an 11th key. The count and the insert share a transaction, but two
 * creates at the same instant can still both pass the count; one key over the
 * cap does no harm, so this is not serialised.
 *
 * `name` is trimmed and validated by the route. Captures `api_key:created`
 * after the commit; analytics only, so a capture failure never fails the create.
 */
export async function createApiKey(
  userId: string,
  name: string,
  /** 1 to `MAX_API_KEY_EXPIRY_DAYS`, validated by the route; null for a key that does not expire. */
  expiresInDays: number | null = null,
): Promise<CreateApiKeyResult> {
  const key = generateApiKey()
  const expiresAt = expiresInDays === null ? null : new Date(Date.now() + expiresInDays * DAY_MS)
  const row = await prisma.$transaction(async (tx) => {
    const count = await tx.apiKey.count({ where: { userId } })
    if (count >= MAX_API_KEYS_PER_USER) return null
    return tx.apiKey.create({
      data: { userId, name, start: apiKeyStart(key), hash: hashApiKey(key), expiresAt },
      select: SUMMARY_SELECT,
    })
  })
  if (!row) return { status: 'limit_reached' }

  await captureKeyEvent(userId, userId, API_KEY_CREATED_EVENT, { expires_in_days: expiresInDays })
  return { status: 'created', key, apiKey: toSummary(row) }
}

/**
 * Deletes a key the viewer may revoke, so its next request answers 401: their
 * own, or, for a household's owner, any member's (HON-1221). Returns false when
 * the viewer has no such key, which includes a key outside their scope: the
 * route answers 404 for both, so it does not confirm the key exists.
 *
 * The delete repeats the scope, so a member who leaves the household between
 * the two statements keeps their key.
 */
export async function revokeApiKey(viewer: ApiKeyViewer, id: string): Promise<boolean> {
  const where: Prisma.ApiKeyWhereInput = { id, ...viewerScope(viewer) }
  const row = await prisma.apiKey.findFirst({
    where,
    select: { userId: true, createdAt: true, lastUsedAt: true },
  })
  if (!row) return false
  const { count } = await prisma.apiKey.deleteMany({ where })
  if (count === 0) return false

  await captureKeyEvent(viewer.userId, row.userId, API_KEY_REVOKED_EVENT, {
    days_since_created: Math.floor((Date.now() - row.createdAt.getTime()) / DAY_MS),
    was_used: row.lastUsedAt !== null,
    by_owner: row.userId !== viewer.userId,
  })
  return true
}

/**
 * The user a key belongs to, or null for a malformed, unknown or expired key.
 * Writes `lastUsedAt` in the same statement: one update per poll costs what a
 * conditional update would. An expired key matches no row, so its use is not
 * recorded.
 */
export async function verifyApiKey(key: string): Promise<{ userId: string } | null> {
  if (!API_KEY_PATTERN.test(key)) return null
  const now = new Date()
  try {
    return await prisma.apiKey.update({
      where: { hash: hashApiKey(key), OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { lastUsedAt: now },
      select: { userId: true },
    })
  } catch (error) {
    // No row has this hash, or the key has expired.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return null
    }
    throw error
  }
}

/** True when the user exists and has not asked for deletion. */
export async function isActiveApiKeyUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { deletedAt: true } })
  return user !== null && user.deletedAt === null
}

/**
 * A server event listed under "Server events" in `src/lib/analytics.ts`. The
 * distinct id is the user who acted; `key_count` counts the keys of the user
 * the key belongs to, who differs when an owner revokes a member's key. Never
 * the key, its start or its name.
 */
async function captureKeyEvent(
  actorId: string,
  keyUserId: string,
  event: string,
  properties: Record<string, unknown>,
): Promise<void> {
  try {
    const [membership, keyCount] = await Promise.all([
      prisma.householdMember.findFirst({
        where: { userId: actorId },
        select: { householdId: true },
      }),
      prisma.apiKey.count({ where: { userId: keyUserId } }),
    ])
    getPosthogServer()?.capture({
      distinctId: actorId,
      event,
      properties: sanitizeEventProperties({
        household_id: membership?.householdId ?? null,
        key_count: keyCount,
        ...properties,
      }),
    })
  } catch {
    // Analytics only.
  }
}
