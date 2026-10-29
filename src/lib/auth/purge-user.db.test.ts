import { describe, expect, it } from 'vitest'

import { findUsersDueForPurge } from '@/lib/auth/purge-user'
import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.
// The cascade itself is covered against a mocked client in `purge-user.test.ts`.

const NOW = new Date('2026-10-15T03:00:00.000Z')
const MINUTE_MS = 60 * 1000

async function user(id: string, deletedAt: Date | null, purgeScheduledFor: Date | null) {
  await prisma.user.create({
    data: { id, name: id, email: `${id}@example.com`, deletedAt, purgeScheduledFor },
  })
}

describe('findUsersDueForPurge', () => {
  it('selects only soft-deleted users whose purge instant has passed', async () => {
    const requested = new Date('2026-09-14T10:00:00.000Z')
    await user('due', requested, new Date(NOW.getTime() - MINUTE_MS))
    await user('long-overdue', requested, new Date('2026-09-01T03:00:00.000Z'))
    await user('in-window', requested, new Date(NOW.getTime() + MINUTE_MS))
    await user('due-this-instant', requested, NOW)
    await user('live', null, null)
    // A restored account keeps no timestamps; a stray purge date alone must
    // never schedule a live account.
    await user('live-with-stray-date', null, new Date(NOW.getTime() - MINUTE_MS))

    const due = await findUsersDueForPurge(NOW)

    expect(due.sort()).toEqual(['due', 'long-overdue'])
  })

  it('selects no one when nobody has requested deletion', async () => {
    await user('live', null, null)

    expect(await findUsersDueForPurge(NOW)).toEqual([])
  })
})
