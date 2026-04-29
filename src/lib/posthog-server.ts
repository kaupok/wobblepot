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

    // Defensive backstop: drain the in-memory queue when the isolate is
    // actually shutting down (idle timeout, scale-down, deploy churn). The
    // primary per-request flush mechanisms — `await captureExceptionImmediate`
    // in `instrumentation.onRequestError`, and `next/after(() => flush())` in
    // `captureApiError` — handle the hot path. This handler complements them
    // by catching queued events that hadn't drained when AWS Lambda delivers
    // SIGTERM (with a 500ms–6s grace window before SIGKILL).
    if (process.env.VERCEL && process.env.NEXT_RUNTIME === 'nodejs') {
      process.once('SIGTERM', () => {
        // `shutdown(timeout)` rejects with a string when the timeout fires
        // before the queue drains. Swallow it — partial drain is fine, and an
        // unhandled rejection would crash the isolate before SIGKILL (Node 22
        // default `--unhandled-rejections=throw`), defeating the flush.
        globalForPosthog.posthog?.shutdown(2000).catch(() => {})
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
