import { describe, expect, it } from 'vitest'

import { createApiKey } from '@/lib/api-keys'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.
// A read-only API key must never turn into a session (HON-1220): no Better
// Auth plugin or hook reads it, so every route that calls `getSession` treats
// a request that carries only a key as signed out.

describe('API keys and Better Auth sessions (HON-1220)', () => {
  it('getSession returns null for a request that carries only a valid key', async () => {
    await prisma.user.create({ data: { id: 'u-ada', name: 'Ada', email: 'ada@example.com' } })
    const result = await createApiKey('u-ada', 'Kitchen screen')
    if (result.status !== 'created') throw new Error('Expected a key')

    const session = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${result.key}` }),
    })

    expect(session).toBeNull()
  })
})
