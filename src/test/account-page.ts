import enMessages from '../../messages/en.json'

/**
 * Shared fixtures for the `/account` page tests (HON-1229). Each page test
 * mocks `next-intl/server` with `catalogTranslations`, so a Server Component
 * renders as if the i18n pipeline had configured a request:
 *
 *   vi.mock('next-intl/server', async () => ({
 *     getTranslations: vi.fn((await import('@/test/account-page')).catalogTranslations),
 *   }))
 */
export async function catalogTranslations(namespace: string) {
  let cursor: unknown = enMessages
  for (const segment of namespace.split('.')) {
    cursor = (cursor as Record<string, unknown>)?.[segment]
  }
  const t = (key: string, values: Record<string, string> = {}) => {
    let node: unknown = cursor
    for (const segment of key.split('.')) {
      node = (node as Record<string, unknown>)?.[segment]
    }
    if (typeof node !== 'string') return key
    return node.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match)
  }
  // Enough of `t.rich` for one `<tag>…</tag>` pair, which is all these pages use.
  t.rich = (key: string, tags: Record<string, (chunks: string) => unknown>) => {
    const match = /^(.*)<(\w+)>(.*)<\/\2>(.*)$/.exec(t(key))
    if (!match) return t(key)
    const [, before, tag, inner, after] = match
    return [before, tags[tag!]!(inner!), after]
  }
  return t
}

const now = new Date()

export const accountSession = {
  session: {
    id: 'session-123',
    userId: 'user-123',
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    token: 'test-token',
    ipAddress: '127.0.0.1',
    userAgent: 'test',
    createdAt: now,
    updatedAt: now,
  },
  user: {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    emailVerified: false,
    image: null,
    createdAt: now,
    updatedAt: now,
  },
}

export function membershipWithMemberCount(members: number, role: 'owner' | 'member' = 'owner') {
  return {
    id: 'member-123',
    householdId: 'household-123',
    userId: 'user-123',
    name: null,
    role,
    joinedAt: now,
    household: {
      id: 'household-123',
      name: 'Doe Family',
      timezone: 'Europe/Tallinn',
      locale: 'en',
      createdAt: now,
      preferences: null,
      _count: { members },
    },
  }
}
