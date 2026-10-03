import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { headers } from 'next/headers'
import { clientSessionProperties, type ClientSessionProperties } from '@/lib/posthog-cookie'

const storage = new AsyncLocalStorage<string>()

type RouteHandler<Args extends unknown[]> = (...args: Args) => Promise<Response> | Response

/**
 * Wrap a route handler so every call runs inside an AsyncLocalStorage scope
 * keyed by a fresh `crypto.randomUUID()`. Child code can call `getRequestId()`
 * anywhere in the async chain to get the same id.
 */
export function withRequestId<Args extends unknown[]>(
  handler: RouteHandler<Args>,
): RouteHandler<Args> {
  return (...args: Args) => storage.run(crypto.randomUUID(), () => handler(...args))
}

/**
 * Returns the current request id if called inside a `withRequestId`-wrapped
 * handler; otherwise returns undefined.
 */
export function getRequestId(): string | undefined {
  return storage.getStore()
}

/**
 * `$session_id` and `$current_url` of the browser session behind the current
 * request, read from its PostHog cookie and `Referer` (see `posthog-cookie.ts`).
 * Spread the result into a server event's properties so PostHog joins the
 * event to that session (HON-998).
 *
 * Resolves to `{}` outside a request scope (a script, a cron job), where
 * `headers()` throws, and when the user has not consented, because posthog-js
 * then sets no cookie. Never rejects. Like any `headers()` call, it makes a
 * statically prerendered page dynamic, so keep it to request-time paths.
 */
export async function getClientSession(): Promise<ClientSessionProperties> {
  try {
    const requestHeaders = await headers()
    return clientSessionProperties((name) => requestHeaders.get(name))
  } catch {
    return {}
  }
}
