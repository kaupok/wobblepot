import { afterEach, describe, expect, it, vi } from 'vitest'

// No `vi.mock('@/lib/prisma')` here on purpose: this file runs the global mock
// in `vitest.setup.ts`, which is what every test that loads auth transitively
// relies on.

const UNREACHABLE = 'postgresql://postgres:postgres@127.0.0.1:1/unreachable'

describe('auth initialisation in unit tests', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // The `mcp()` plugin seeds the MCP resource row at init. Without the global
  // mock, the seed query reaches for a database, and a refused connection
  // fails the run on an unhandled rejection (HON-1183).
  it('completes without a reachable database', async () => {
    vi.stubEnv('DATABASE_URL', UNREACHABLE)
    vi.stubEnv('DATABASE_URL_UNPOOLED', UNREACHABLE)
    // `src/lib/prisma.ts` reuses a client cached on `globalThis`, which would
    // keep the connection string of an earlier import.
    delete (globalThis as { prisma?: unknown }).prisma
    vi.resetModules()

    const { auth } = await import('@/lib/auth')

    await expect(auth.$context).resolves.toBeDefined()
  })
})
