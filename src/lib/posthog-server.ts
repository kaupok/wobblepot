import 'server-only'
import { waitUntil } from '@vercel/functions'
import { PostHog } from 'posthog-node'
import { serverEnv } from '@/lib/env'
import { sanitizeEventProperties } from '@/lib/redact'

const globalForPosthog = globalThis as unknown as {
  posthog: PostHog | undefined
}

export function getPosthogServer(): PostHog | null {
  // Vitest exercises real route catch-blocks that call `captureApiError`, plus
  // real analytics captures. With `flushAt: 1` / `flushInterval: 0` those
  // fixture errors ship to the live project and bury genuine exceptions. Return
  // no client under test — one gate covers every server-side capture path.
  if (process.env.VITEST) {
    return null
  }

  if (!serverEnv.NEXT_PUBLIC_POSTHOG_KEY || !serverEnv.NEXT_PUBLIC_POSTHOG_HOST) {
    return null
  }

  if (!globalForPosthog.posthog) {
    globalForPosthog.posthog = new PostHog(serverEnv.NEXT_PUBLIC_POSTHOG_KEY, {
      host: serverEnv.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
      // Hand the SDK Vercel's `waitUntil` so it can extend the function's
      // lifetime past the response while the queued event flushes — the
      // primitive that actually keeps a Vercel isolate alive on this path.
      // Outside Vercel, `@vercel/functions`'s `waitUntil` is a no-op
      // (`getContext().waitUntil?.(p)`), and the SDK guards the call with
      // try/catch — so this is safe to set unconditionally and works in dev.
      // This is the pattern Sentry's `captureRequestError` uses, and PostHog's
      // own SDK docstring on this option points at exactly this Vercel setup.
      waitUntil,
      before_send: (event) => {
        if (!event) return event
        return { ...event, properties: sanitizeEventProperties(event.properties) }
      },
    })

    // Defensive backstop for events that haven't drained when the isolate
    // actually shuts down (idle timeout, scale-down, deploy churn). The
    // per-request flush is now owned by the SDK's `waitUntil` integration —
    // this handler only catches the residue. AWS Lambda gives a 500ms–6s
    // SIGTERM grace window before SIGKILL.
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
