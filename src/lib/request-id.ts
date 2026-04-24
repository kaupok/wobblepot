import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

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
