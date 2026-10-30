import { describe, expect, it } from 'vitest'

import type { Member } from '@/types/member'

import { toMemberPortions } from './use-member-portions'

function member(overrides: Partial<Member>): Member {
  return {
    id: 'm1',
    userId: null,
    name: null,
    role: 'member',
    joinedAt: '2026-01-01T00:00:00.000Z',
    user: null,
    preferences: null,
    invite: null,
    ...overrides,
  }
}

describe('toMemberPortions', () => {
  it('names a member by display name, then account name, then member name', () => {
    const portions = toMemberPortions(
      [
        member({
          id: 'a',
          name: 'Kaupo K',
          user: { id: 'u1', name: 'Kaupo Kõrv', email: 'k@example.com', image: null },
          preferences: { displayName: 'Kaupo', portionMultiplier: 1.5 },
        }),
        member({
          id: 'b',
          name: 'Mari M',
          user: { id: 'u2', name: 'Mari', email: 'm@example.com', image: null },
        }),
        member({ id: 'c', name: 'Nora' }),
      ],
      null,
    )
    expect(portions.map((portion) => portion.name)).toEqual(['Kaupo', 'Mari', 'Nora'])
  })

  it('reads a member with no preferences as a 1× portion', () => {
    const [portion] = toMemberPortions([member({ name: 'Nora' })], null)
    expect(portion!.multiplier).toBe(1)
  })

  it('marks only the signed-in user as self', () => {
    const portions = toMemberPortions(
      [
        member({ id: 'a', name: 'Kaupo', userId: 'u1' }),
        member({ id: 'b', name: 'Mari', userId: 'u2' }),
        member({ id: 'c', name: 'Nora' }),
      ],
      'u2',
    )
    expect(portions.map((portion) => portion.isSelf)).toEqual([false, true, false])
  })

  it('marks no one as self without a signed-in user', () => {
    const portions = toMemberPortions([member({ name: 'Nora', userId: null })], undefined)
    expect(portions[0]!.isSelf).toBe(false)
  })

  it('leaves out a member with no name', () => {
    expect(toMemberPortions([member({ name: null })], null)).toEqual([])
  })
})
