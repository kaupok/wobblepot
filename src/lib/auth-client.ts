import { createAuthClient } from 'better-auth/react'
import { getClientBaseURL } from '@/lib/env'

export const authClient = createAuthClient({
  baseURL: getClientBaseURL(),
})
