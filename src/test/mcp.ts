import type { McpHousehold } from '@/lib/mcp/context'

/**
 * Helpers for tests that drive the MCP server (HON-1151) with raw JSON-RPC,
 * the way a client does.
 */

export const MCP_TEST_URL = 'http://localhost:3000/api/mcp'

/** The per-request envelope of the 2026-07-28 protocol. */
const MODERN_PROTOCOL = '2026-07-28'
const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL,
  'io.modelcontextprotocol/clientInfo': { name: 'vitest', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

let nextId = 1

/**
 * A 2026-07-28 request: the `_meta` envelope plus the headers that must agree
 * with the body (`MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` for a
 * tool call). The server answers it with a single JSON body.
 */
export function mcpRequest(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Request {
  const name = typeof params.name === 'string' ? params.name : undefined
  return new Request(MCP_TEST_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MODERN_PROTOCOL,
      'mcp-method': method,
      ...(name ? { 'mcp-name': name } : {}),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId++,
      method,
      params: { ...params, _meta: MODERN_META },
    }),
  })
}

/** A 2025-era request: no envelope, answered over a one-message SSE stream. */
export function legacyMcpRequest(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Request {
  return new Request(MCP_TEST_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  })
}

export interface McpToolResultBody {
  isError?: boolean
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
}

export interface JsonRpcBody<Result = unknown> {
  result?: Result
  error?: { code: number; message: string }
}

/** The JSON-RPC body of a response, whether it came as JSON or as SSE. */
export async function readMcpBody<Result = unknown>(
  response: Response,
): Promise<JsonRpcBody<Result>> {
  const text = await response.text()
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    return JSON.parse(text)
  }
  const data = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .find(Boolean)
  if (!data) throw new Error(`No data frame in SSE response: ${text}`)
  return JSON.parse(data)
}

/** A household as `getHouseholdMembership` returns it, with only what the tools read. */
export function mcpHousehold(overrides: Partial<McpHousehold> = {}): McpHousehold {
  return {
    id: 'household-1',
    name: 'Test household',
    locale: 'en',
    timezone: 'Europe/Tallinn',
    preferences: null,
    _count: { members: 2 },
    members: [{ preferences: { portionMultiplier: 1 } }, { preferences: { portionMultiplier: 1 } }],
    ...overrides,
  } as McpHousehold
}
