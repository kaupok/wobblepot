import { describe, expect, it } from 'vitest'

import { prisma } from '@/lib/prisma'

// Runs against PGlite through the `unit-db` project, which applies every
// migration. HON-1324 removed the member food and macro fields from the
// schema; HON-1327's migration drops their columns, so the table holds only
// what `MemberPreferences` names.

describe('member_preferences columns', () => {
  it('holds only the columns the MemberPreferences model names', async () => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'member_preferences'
      ORDER BY column_name
    `

    expect(rows.map((row) => row.column_name)).toEqual([
      'createdAt',
      'displayName',
      'id',
      'memberId',
      'portionMultiplier',
      'updatedAt',
    ])
  })
})
