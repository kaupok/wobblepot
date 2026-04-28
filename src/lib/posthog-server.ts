import 'server-only'
import { PostHog } from 'posthog-node'
import { serverEnv } from '@/lib/env'
import { sanitizeEventProperties } from '@/lib/redact'

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
      before_send: (event) => {
        if (!event) return event
        return { ...event, properties: sanitizeEventProperties(event.properties) }
      },
    })

    // Vercel Node functions run on AWS Lambda, which sends SIGTERM with a small
    // grace window (500ms–6s) before SIGKILL. Drain the in-memory queue inside
    // that window — request-context primitives (`waitUntil`, `next/after`) are
    // unbound inside `instrumentation.onRequestError`, so the per-request flush
    // path doesn't survive isolate teardown otherwise.
    if (process.env.VERCEL && process.env.NEXT_RUNTIME === 'nodejs') {
      process.once('SIGTERM', () => {
        void globalForPosthog.posthog?.shutdown(2000)
      })
    }
  }

  return globalForPosthog.posthog
}

export async function shutdownPosthog(): Promise<void> {
  if (globalForPosthog.posthog) {
    await globalForPosthog.posthog.shutdown()
    globalForPosthog.posthog = undefined
  }
}
