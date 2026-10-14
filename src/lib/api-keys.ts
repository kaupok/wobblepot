import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { getPosthogServer } from '@/lib/posthog-server'
import { sanitizeEventProperties } from '@/lib/redact'

/**
 * Read-only API keys for screens and scripts (HON-1220). A member makes one on
 * `/profile`, and `GET /api/v1/meal-plan` and `GET /api/v1/shopping-list`
 * accept it as `Authorization: Bearer wp_…` (`src/lib/api/v1/caller.ts`).
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
} as const

function toSummary(row: {
  id: string
  name: string
  start: string
  createdAt: Date
  lastUsedAt: Date | null
}): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    start: row.start,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }
}

/** The user's own keys, oldest first. */
export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  const rows = await prisma.apiKey.findMany({
    where: { userId },
    select: SUMMARY_SELECT,
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(toSummary)
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
export async function createApiKey(userId: string, name: string): Promise<CreateApiKeyResult> {
  const key = generateApiKey()
  const row = await prisma.$transaction(async (tx) => {
    const count = await tx.apiKey.count({ where: { userId } })
    if (count >= MAX_API_KEYS_PER_USER) return null
    return tx.apiKey.create({
      data: { userId, name, start: apiKeyStart(key), hash: hashApiKey(key) },
      select: SUMMARY_SELECT,
    })
  })
  if (!row) return { status: 'limit_reached' }

  await captureKeyEvent(userId, API_KEY_CREATED_EVENT, {})
  return { status: 'created', key, apiKey: toSummary(row) }
}

/**
 * Deletes one of the user's keys, so its next request answers 401. Returns
 * false when the user has no key with that id, which includes another user's
 * key: the route answers 404 for both, so it does not confirm the key exists.
 */
export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
  const row = await prisma.apiKey.findFirst({
    where: { id, userId },
    select: { createdAt: true, lastUsedAt: true },
  })
  if (!row) return false
  const { count } = await prisma.apiKey.deleteMany({ where: { id, userId } })
  if (count === 0) return false

  await captureKeyEvent(userId, API_KEY_REVOKED_EVENT, {
    days_since_created: Math.floor((Date.now() - row.createdAt.getTime()) / DAY_MS),
    was_used: row.lastUsedAt !== null,
  })
  return true
}

/**
 * The user a key belongs to, or null for a malformed or unknown key. Writes
 * `lastUsedAt` in the same statement: one update per poll costs what a
 * conditional update would.
 */
export async function verifyApiKey(key: string): Promise<{ userId: string } | null> {
  if (!API_KEY_PATTERN.test(key)) return null
  try {
    return await prisma.apiKey.update({
      where: { hash: hashApiKey(key) },
      data: { lastUsedAt: new Date() },
      select: { userId: true },
    })
  } catch (error) {
    // No row has this hash.
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
 * distinct id is the user id. Never the key, its start or its name.
 */
async function captureKeyEvent(
  userId: string,
  event: string,
  properties: Record<string, unknown>,
): Promise<void> {
  try {
    const [membership, keyCount] = await Promise.all([
      prisma.householdMember.findFirst({ where: { userId }, select: { householdId: true } }),
      prisma.apiKey.count({ where: { userId } }),
    ])
    getPosthogServer()?.capture({
      distinctId: userId,
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
