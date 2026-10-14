import { describe, it, expect } from 'vitest'
import { pingDatabase } from '@/lib/status/probes'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.

describe('pingDatabase', () => {
  it('resolves against a live database', async () => {
    await expect(pingDatabase()).resolves.toBeUndefined()
  })
})
