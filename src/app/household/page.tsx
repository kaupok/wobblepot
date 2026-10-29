import { dehydrate, HydrationBoundary } from '@tanstack/react-query'

import { MemberList } from '@/components/household/MemberList'
import { MEMBERS_QUERY_KEY, type MembersResponse } from '@/components/household/members-query'
import { getQueryClient } from '@/lib/get-query-client'
import { listHouseholdMembers } from '@/lib/household'

import { householdTabMetadata, requireHouseholdMember } from './household-member'

export function generateMetadata() {
  return householdTabMetadata('members')
}

/**
 * Household → Members (HON-1257): the member list with its invites. No
 * owner-only notice here: a member can edit their own row (HON-960).
 */
export default async function HouseholdMembersPage() {
  const { membership, isOwner } = await requireHouseholdMember()

  // Prefetch the roster so the Members list is in the first HTML response
  // instead of behind a second client round trip (HON-780, after HON-770). A
  // failed prefetch is not dehydrated, so `MemberList` falls back to fetching
  // it itself; no retries here, since the default two would hold the render.
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery({
    queryKey: MEMBERS_QUERY_KEY,
    retry: false,
    queryFn: async () => {
      const members = await listHouseholdMembers(membership.householdId)
      // Round-trip through JSON so the cached response has the wire shape the
      // client's `apiFetch` produces (dates as ISO strings, not `Date`).
      return JSON.parse(
        JSON.stringify({ householdId: membership.householdId, members }),
      ) as MembersResponse
    },
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MemberList isOwner={isOwner} currentMemberId={membership.id} />
    </HydrationBoundary>
  )
}
