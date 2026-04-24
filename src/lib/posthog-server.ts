import 'server-only'
import { PostHog } from 'posthog-node'
import { serverEnv } from '@/lib/env'

const globalForPosthog = globalThis as unknown as {
  posthog: PostHog | undefined
}

export function getPosthogServer(): PostHog | null {
  if (!serverEnv.NEXT_PUBLIC_POSTHOG_KEY || !serverEnv.NEXT_PUBLIC_POSTHOG_HOST) {
    return null
  }

  if (!globalForPosthog.posthog) {
    globalForPosthog.posthog = new PostHog(serverEnv.NEXT_PUBLIC_POSTHOG_KEY, {
      host: serverEnv.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    })
  }

  return globalForPosthog.posthog
}

export async function shutdownPosthog(): Promise<void> {
  if (globalForPosthog.posthog) {
    await globalForPosthog.posthog.shutdown()
    globalForPosthog.posthog = undefined
  }
}
