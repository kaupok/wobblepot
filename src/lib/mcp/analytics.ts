import 'server-only'

import type { McpServer } from '@modelcontextprotocol/server'
import { type BeforeSendFn, instrument } from '@posthog/mcp'

import type { McpCallerContext } from '@/lib/mcp/context'
import { getPosthogMcpServer } from '@/lib/posthog-server'

/**
 * The `beforeSend` for every MCP event: drops what a tool was asked and what it
 * answered. Parameters can hold a search string, and responses hold the
 * household's meals and pantry; neither belongs in analytics.
 *
 * `$mcp_intent`, the agent's one-sentence reason for the call, stays in full.
 * That is a decision, not an oversight: it is what the MCP analytics view
 * clusters on, and the consent page names it. The client's sanitiser does not
 * shorten it, because `sanitizeEventProperties` passes `$`-prefixed keys through.
 */
export const stripMcpPayload: BeforeSendFn = (event) => {
  delete event.properties.$mcp_parameters
  delete event.properties.$mcp_response
  return event
}

/**
 * PostHog MCP analytics for one request's server (HON-1151): `$mcp_tool_call`
 * per call and `$mcp_tools_list`. A failed call is marked `$mcp_is_error`.
 *
 * Exception autocapture is off: `runTool` reports a failed call itself, with
 * the real stack, because the SDK wrapper only sees the error result (see
 * `runTool`). Left on, it would also send a stackless `$exception` for every
 * refusal (no household, the rate limit, an unknown meal id).
 *
 * Events go through `getPosthogMcpServer()`, a client of its own with the same
 * options as the shared one (`waitUntil` flush, URL redaction, sanitiser).
 * Not the shared client: `instrument` rewrites the library id of the client it
 * gets, which would relabel every other server event. With no client (tests,
 * no key) nothing is wired.
 *
 * Server-side, so the cookie-consent gate (HON-462) does not apply, the same
 * as `$ai_generation`. The consent page says what an event holds, the
 * assistant's reason (`$mcp_intent`) included.
 */
export function instrumentMcpServer(server: McpServer, ctx: McpCallerContext): void {
  const posthog = getPosthogMcpServer()
  if (!posthog) return

  const serverBuild = process.env.VERCEL_GIT_COMMIT_SHA
  instrument(server, posthog, {
    // The verified token's `sub`, so the events join the person PostHog knows
    // from sign-in. Never re-read from the request headers.
    identify: async () => ({ distinctId: ctx.userId }),
    // The key the client-side wrapper attaches to every product event.
    eventProperties: () => (ctx.household ? { household_id: ctx.household.id } : null),
    beforeSend: stripMcpPayload,
    enableExceptionAutocapture: false,
    ...(serverBuild ? { serverBuild } : {}),
  })
}
