'use client'

import { useQuery } from '@tanstack/react-query'

import { MEMBERS_QUERY_KEY, type MembersResponse } from '@/components/household/members-query'
import { apiFetch } from '@/lib/api'
import type { Member } from '@/types/member'

/** One member's plate, for the cook view's nutrition chips (HON-1475). */
export interface MemberPortion {
  id: string
  name: string
  multiplier: number
}

/**
 * Each named member's portion, in the members list order. The name follows
 * `listMembersForAssistant`, so a chip reads as the household page does; a
 * member with no name has no chip to label, so it is left out.
 */
export function toMemberPortions(members: Member[]): MemberPortion[] {
  return members.flatMap((member) => {
    const name = member.preferences?.displayName || member.user?.name || member.name
    if (!name) return []
    return [
      {
        id: member.id,
        name,
        multiplier: member.preferences?.portionMultiplier ?? 1,
      },
    ]
  })
}

/**
 * The household's member portions, or `undefined` while the members load,
 * when the request fails, or when `enabled` is false. The caller turns it off where
 * there is no household (the landing deck), so that view makes no request.
 */
export function useMemberPortions(enabled: boolean): MemberPortion[] | undefined {
  const members = useQuery({
    queryKey: MEMBERS_QUERY_KEY,
    queryFn: () => apiFetch<MembersResponse>('/api/households/me/members'),
    select: (data) => data.members,
    enabled,
  })

  if (!enabled || !members.data) return undefined
  return toMemberPortions(members.data)
}
