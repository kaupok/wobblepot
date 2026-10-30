'use client'

import { useQuery } from '@tanstack/react-query'

import { MEMBERS_QUERY_KEY, type MembersResponse } from '@/components/household/members-query'
import { apiFetch } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
import type { Member } from '@/types/member'

/** One member's plate, for the cook view's nutrition chips (HON-1475). */
export interface MemberPortion {
  id: string
  name: string
  multiplier: number
  /** The signed-in user's own member. */
  isSelf: boolean
}

const SESSION_QUERY_KEY = ['auth-session'] as const

/**
 * Each named member's portion, in the members list order. The name follows
 * `listMembersForAssistant`, so a chip reads as the household page does; a
 * member with no name has no chip to label, so it is left out.
 */
export function toMemberPortions(
  members: Member[],
  userId: string | null | undefined,
): MemberPortion[] {
  return members.flatMap((member) => {
    const name = member.preferences?.displayName || member.user?.name || member.name
    if (!name) return []
    return [
      {
        id: member.id,
        name,
        multiplier: member.preferences?.portionMultiplier ?? 1,
        isSelf: !!userId && member.userId === userId,
      },
    ]
  })
}

/**
 * The household's member portions, or `undefined` while either query loads,
 * when one fails, or when `enabled` is false. The caller turns it off where
 * there is no household (the landing deck), so that view makes no request.
 */
export function useMemberPortions(enabled: boolean): MemberPortion[] | undefined {
  const members = useQuery({
    queryKey: MEMBERS_QUERY_KEY,
    queryFn: () => apiFetch<MembersResponse>('/api/households/me/members'),
    select: (data) => data.members,
    enabled,
  })
  // `authClient.useSession()` fetches on mount and cannot be turned off, so
  // the session goes through a query that can.
  const session = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await authClient.getSession()
      if (error) throw new Error(error.message ?? 'Failed to fetch session')
      return data
    },
    enabled,
  })

  if (!enabled || !members.data || !session.isSuccess) return undefined
  return toMemberPortions(members.data, session.data?.user.id)
}
