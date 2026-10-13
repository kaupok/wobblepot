import { expect, type APIRequestContext } from '@playwright/test'

/**
 * Calls to the Wobblepot MCP server (HON-1151) the way a client makes them.
 * Shared by `mcp-read.spec.ts` and `mcp-write.spec.ts`.
 */

let nextId = 1

/**
 * One JSON-RPC call in the 2025 style, which most clients still send: no
 * per-request envelope, answered over a one-message SSE stream.
 */
export async function mcpCall(
  request: APIRequestContext,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await request.post('/api/mcp', {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: nextId++, method, params },
  })
  expect(response.status(), await response.text()).toBe(200)
  const text = await response.text()
  const data = response.headers()['content-type']?.includes('text/event-stream')
    ? text
        .split('\n')
        .find((line) => line.startsWith('data:'))
        ?.slice('data:'.length)
    : text
  expect(data, `No JSON-RPC body in: ${text}`).toBeTruthy()
  const body = JSON.parse(data!) as { result?: unknown; error?: { message: string } }
  expect(body.error).toBeUndefined()
  return body.result
}

export interface McpToolResult<Structured = Record<string, unknown>> {
  isError?: boolean
  content: { type: string; text: string }[]
  structuredContent?: Structured
}

/** `tools/call` for one tool. */
export async function mcpCallTool<Structured = Record<string, unknown>>(
  request: APIRequestContext,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult<Structured>> {
  return (await mcpCall(request, token, 'tools/call', {
    name,
    arguments: args,
  })) as McpToolResult<Structured>
}
