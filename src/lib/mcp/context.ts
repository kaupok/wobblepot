import 'server-only'
import type { z } from 'zod'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/server'
import type { getHouseholdMembership } from '@/lib/household'
import { captureApiError } from '@/lib/errors'
import { checkRateLimit } from '@/lib/rate-limit'
import { MCP_WRITE_SCOPE } from './oauth'

/** The household row `getHouseholdMembership` returns, with its preferences and members. */
export type McpHousehold = NonNullable<
  Awaited<ReturnType<typeof getHouseholdMembership>>
>['household']

/**
 * Who is calling, resolved once per request by `src/app/api/mcp/route.ts` from
 * the verified access token. `household` is null for an account that has not
 * finished onboarding; every tool then answers with {@link NO_HOUSEHOLD_MESSAGE}.
 * `scopes` are the token's granted scopes; a write tool needs `mcp:write`.
 */
export interface McpCallerContext {
  userId: string
  household: McpHousehold | null
  scopes: readonly string[]
}

export const NO_HOUSEHOLD_MESSAGE =
  'This account has no household yet. Finish onboarding in Wobblepot first.'

/**
 * What a write tool answers to a token without `mcp:write`. The write tools
 * are listed for every token, so the model can tell the user what to do.
 */
export const WRITE_SCOPE_MESSAGE =
  'This assistant can only read Wobblepot. To let it change the shopping list, pantry or meal plan, disconnect it and connect it again, then choose Allow.'

/**
 * A read tool: a client may run it freely. Anthropic's connector directory
 * review asks for all three hints. The default for a tool that sets no
 * `annotations`.
 */
export const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
}

/**
 * A write tool that changes only the household's own data, never deletes what
 * the app cannot restore, and gives the same result when repeated (HON-1154).
 * A tool that is not idempotent spreads this and sets `idempotentHint: false`.
 */
export const WRITE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

/**
 * A request the household's data cannot answer (an unknown meal id, a date
 * range the wrong way round). {@link runTool} turns it into an `isError`
 * result with this message, so it does not reach error tracking as a failure.
 * The message is for the model, so it is a plain sentence, never a server error.
 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}

/**
 * One tool. `run` gets the caller's household, the input after the SDK
 * validated it against `inputSchema`, and the caller's user id (for a feature
 * flag read per user), and returns the object that becomes both the text
 * content and `structuredContent`. MCP requires `structuredContent`
 * to be an object, so a list is wrapped in a key.
 *
 * `annotations` defaults to {@link READ_ONLY_ANNOTATIONS}. Any tool whose
 * annotations do not say `readOnlyHint: true` needs `mcp:write` (see
 * {@link isWriteTool}).
 */
export interface McpTool<
  Input extends z.ZodObject = z.ZodObject,
  Output extends z.ZodObject = z.ZodObject,
> {
  name: string
  title: string
  description: string
  inputSchema: Input
  outputSchema: Output
  annotations?: ToolAnnotations
  run: (
    household: McpHousehold,
    input: z.output<Input>,
    caller: Pick<McpCallerContext, 'userId'>,
  ) => Promise<z.output<Output>>
}

/** Keeps each tool file's `run` typed against its own schemas. */
export function defineTool<Input extends z.ZodObject, Output extends z.ZodObject>(
  tool: McpTool<Input, Output>,
): McpTool<Input, Output> {
  return tool
}

/** The annotations a tool is listed with. */
export function toolAnnotations(tool: Pick<McpTool, 'annotations'>): ToolAnnotations {
  return tool.annotations ?? READ_ONLY_ANNOTATIONS
}

/**
 * True unless the tool says it only reads. Fails closed: a tool that sets
 * annotations without `readOnlyHint: true` is gated as a write.
 */
export function isWriteTool(tool: Pick<McpTool, 'annotations'>): boolean {
  return toolAnnotations(tool).readOnlyHint !== true
}

/**
 * The scope check every write tool runs first: null when the token carries
 * `mcp:write`, else the {@link WRITE_SCOPE_MESSAGE} result.
 */
export function requireWriteScope(ctx: Pick<McpCallerContext, 'scopes'>): CallToolResult | null {
  return ctx.scopes.includes(MCP_WRITE_SCOPE) ? null : errorResult(WRITE_SCOPE_MESSAGE)
}

export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/** Compact JSON keeps the client's token cost down. */
export function jsonResult(output: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output }
}

/** What the client reads when a tool fails, in place of the server's error text. */
export const TOOL_FAILED_MESSAGE = 'Wobblepot could not complete this request. Try again later.'

/**
 * Runs one tool call for the caller: the write-scope check for a write tool
 * first, then the no-household answer, then the household's `mcp` rate limit
 * (reads and writes share it), then the tool.
 *
 * Any other error is reported here with `captureApiError`, once, and the client
 * gets {@link TOOL_FAILED_MESSAGE}. Not left to `@posthog/mcp`: with
 * `@modelcontextprotocol/server` 2.x its wrapper never sees the thrown error,
 * only the SDK's error result, so its `$exception` would carry the client
 * message and no stack. `instrumentMcpServer` turns that capture off, so a
 * failed call yields one `$exception` (HON-1151).
 */
export async function runTool<Input extends z.ZodObject, Output extends z.ZodObject>(
  tool: McpTool<Input, Output>,
  ctx: McpCallerContext,
  input: z.output<Input>,
): Promise<CallToolResult> {
  if (isWriteTool(tool)) {
    const denied = requireWriteScope(ctx)
    if (denied) return denied
  }

  const { household } = ctx
  if (!household) return errorResult(NO_HOUSEHOLD_MESSAGE)

  const limit = await checkRateLimit(household.id, 'mcp')
  if (!limit.allowed) {
    return errorResult(
      `This household has made too many requests to Wobblepot. Try again after ${limit.resetAt.toISOString()}.`,
    )
  }

  try {
    return jsonResult(await tool.run(household, input, { userId: ctx.userId }))
  } catch (error) {
    if (error instanceof ToolInputError) return errorResult(error.message)
    captureApiError(error, {
      route: '/api/mcp',
      userId: ctx.userId,
      householdId: household.id,
      feature: `mcp:${tool.name}`,
    })
    return errorResult(TOOL_FAILED_MESSAGE)
  }
}
