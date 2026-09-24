import type { Member } from '@/types/member'

export type MembersResponse = { householdId: string; members: Member[] }

/**
 * Key shared by the `/household` server prefetch and `MemberList` (HON-780).
 * It lives outside `MemberList.tsx` because that module is `'use client'`: a
 * Server Component importing a plain value from it gets a client reference,
 * not the array, and a mismatched key makes the client ignore the hydrated
 * data and fetch the list again on mount.
 */
export const MEMBERS_QUERY_KEY = ['household-members'] as const
