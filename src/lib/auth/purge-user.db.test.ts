import { describe, expect, it } from 'vitest'

import { findUsersDueForPurge, purgeDueUsers } from '@/lib/auth/purge-user'
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

describe('purgeDueUsers', () => {
  const requested = new Date('2026-09-14T10:00:00.000Z')
  const overdue = new Date(NOW.getTime() - MINUTE_MS)

  async function remainingIds() {
    const rows = await prisma.user.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
    return rows.map(({ id }) => id)
  }

  // 25 is the cap the issue sets (HON-1509); one more must stop the run.
  it('purges no one when 26 users are due', async () => {
    const ids = Array.from({ length: 26 }, (_, i) => `due-${String(i).padStart(2, '0')}`)
    for (const id of ids) await user(id, requested, overdue)

    const result = await purgeDueUsers(NOW, () => {})

    expect(result).toEqual({ capExceeded: true, due: 26 })
    expect(await remainingIds()).toEqual(ids)
  })

  it('purges all 3 due users and leaves the rest', async () => {
    await user('due-a', requested, overdue)
    await user('due-b', requested, overdue)
    await user('due-c', requested, overdue)
    await user('in-window', requested, new Date(NOW.getTime() + MINUTE_MS))
    await user('live', null, null)

    const result = await purgeDueUsers(NOW, () => {})

    expect(result).toEqual({ capExceeded: false, scanned: 3, purged: 3 })
    expect(await remainingIds()).toEqual(['in-window', 'live'])
  })
})
