import 'server-only'

import { waitUntil } from '@vercel/functions'
import { PostHog } from 'posthog-node'

import { serverEnv } from '@/lib/env'
import { redactUrlProperties, sanitizeEventProperties } from '@/lib/redact'

const globalForPosthog = globalThis as unknown as {
  posthog: PostHog | undefined
  posthogMcp: PostHog | undefined
}

/**
 * One server client with the shared options: immediate flush through
 * Vercel's `waitUntil`, URL redaction and the property sanitiser in
 * `before_send`, and a SIGTERM backstop. `getPosthogServer` and
 * `getPosthogMcpServer` each hold one.
 */
function createServerClient(key: string, host: string): PostHog {
  const client = new PostHog(key, {
    host,
    flushAt: 1,
    flushInterval: 0,
    // Hand the SDK Vercel's `waitUntil` so it can extend the function's
    // lifetime past the response while the queued event flushes — the
    // primitive that actually keeps a Vercel isolate alive on this path.
    // Outside Vercel, `@vercel/functions`'s `waitUntil` is a no-op
    // (`getContext().waitUntil?.(p)`), and the SDK guards the call with
    // try/catch — so this is safe to set unconditionally and works in dev.
    // Error SDKs' Next.js `captureRequestError` helpers use the same
    // pattern, and PostHog's own SDK docstring on this option points at
    // exactly this Vercel setup.
    waitUntil,
    before_send: (event) => {
      if (!event) return event
      // URL redaction first: the sanitiser passes `$`-prefixed keys through,
      // and `path` from `onRequestError` can carry a reset token (HON-990).
      return {
        ...event,
        properties: sanitizeEventProperties(redactUrlProperties(event.properties)),
      }
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
      client.shutdown(2000).catch(() => {})
    })
  }

  return client
}

/** The key and host, or null where nothing may be sent (tests, no key). */
function serverClientConfig(): { key: string; host: string } | null {
  // Vitest exercises real route catch-blocks that call `captureApiError`, plus
  // real analytics captures. With `flushAt: 1` / `flushInterval: 0` those
  // fixture errors ship to the live project and bury genuine exceptions. Return
  // no client under test — one gate covers every server-side capture path.
  //
  // Only developer machines were affected: CI sets no `NEXT_PUBLIC_POSTHOG_KEY`,
  // so the key check below already short-circuited there.
  //
  // Consequence: a test cannot assert capture *through* this module. Mock
  // `@/lib/posthog-server` (or `@/lib/errors`) and assert on the mock — the
  // pattern `errors.test.ts`, `feature-flags.test.ts`, `ai/usage.test.ts`, and
  // `instrumentation.test.ts` already use.
  if (process.env.VITEST) {
    return null
  }

  if (!serverEnv.NEXT_PUBLIC_POSTHOG_KEY || !serverEnv.NEXT_PUBLIC_POSTHOG_HOST) {
    return null
  }

  return { key: serverEnv.NEXT_PUBLIC_POSTHOG_KEY, host: serverEnv.NEXT_PUBLIC_POSTHOG_HOST }
}

export function getPosthogServer(): PostHog | null {
  const config = serverClientConfig()
  if (!config) return null
  globalForPosthog.posthog ??= createServerClient(config.key, config.host)
  return globalForPosthog.posthog
}

/**
 * The client for MCP analytics only (HON-1151). `@posthog/mcp`'s `instrument`
 * overwrites the library id of the client it is given, so every event that
 * client sends afterwards carries `$lib: posthog-node-mcp`. Given the shared
 * client, that would relabel every server event, errors and `$ai_generation`
 * included. Same options, same project, separate instance.
 */
export function getPosthogMcpServer(): PostHog | null {
  const config = serverClientConfig()
  if (!config) return null
  globalForPosthog.posthogMcp ??= createServerClient(config.key, config.host)
  return globalForPosthog.posthogMcp
}

export async function shutdownPosthog(): Promise<void> {
  if (globalForPosthog.posthog) {
    await globalForPosthog.posthog.shutdown()
    globalForPosthog.posthog = undefined
  }
  if (globalForPosthog.posthogMcp) {
    await globalForPosthog.posthogMcp.shutdown()
    globalForPosthog.posthogMcp = undefined
  }
}
