import { cache } from 'react'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { hasHouseholdMembership } from '@/lib/household'

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }))

export const getHasHousehold = cache(async (userId: string) => hasHouseholdMembership(userId))
