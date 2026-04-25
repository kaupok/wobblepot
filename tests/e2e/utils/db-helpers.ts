import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

/**
 * Lazy Prisma singleton scoped to the Playwright runner so multiple test files
 * share a single connection pool. Importing the app's `src/lib/prisma.ts`
 * directly works in unit tests but pulls in `server-only` and the proxy-based
 * `serverEnv` — both fine in Node, but we keep this isolated to avoid mixing
 * runtime concerns between the server bundle and the test harness.
 */
let _prisma: PrismaClient | undefined

function getPrisma(): PrismaClient {
  if (!_prisma) {
    const url = process.env.DATABASE_URL
    if (!url) {
      throw new Error(
        '[e2e/db-helpers] DATABASE_URL must be set so seed/cleanup helpers can talk to the same DB the server is using.',
      )
    }
    const adapter = new PrismaPg({ connectionString: url })
    _prisma = new PrismaClient({ adapter })
  }
  return _prisma
}

/**
 * Seeds a unique single-use invite code in the DB and returns the literal
 * code string. Use to satisfy the HON-488 sign-up gate (`invite_code_required`
 * defaults to `true` whenever PostHog is unset, which is the case in CI).
 */
export async function seedInviteCode(): Promise<string> {
  const code = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  await getPrisma().signupCode.create({ data: { code } })
  return code
}

/** Best-effort cleanup helper for tests that want to remove a specific code. */
export async function deleteInviteCode(code: string): Promise<void> {
  await getPrisma().signupCode.deleteMany({ where: { code } })
}
