import { describe, it, expect, vi, beforeEach } from 'vitest'

const { posthog, instrumentSpy } = vi.hoisted(() => ({
  posthog: { capture: vi.fn() },
  instrumentSpy: vi.fn(),
}))

vi.mock('@/lib/posthog-server', () => ({ getPosthogMcpServer: vi.fn(() => posthog) }))
vi.mock('@posthog/mcp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@posthog/mcp')>()
  instrumentSpy.mockImplementation(actual.instrument)
  return { ...actual, instrument: instrumentSpy }
})
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/meal-planning/load-pantry', () => ({ loadPantry: vi.fn() }))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))

import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { getPosthogMcpServer } from '@/lib/posthog-server'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { captureApiError } from '@/lib/errors'
import { mcpHousehold, mcpRequest, readMcpBody } from '@/test/mcp'
import type { McpCallerContext } from './context'
import { instrumentMcpServer, stripMcpPayload } from './analytics'
import { buildMcpServer } from './server'

const ctx: McpCallerContext = { userId: 'user-1', household: mcpHousehold({ id: 'household-1' }) }

type CaptureCall = { distinctId: string; event: string; properties: Record<string, unknown> }

function captures(event: string): CaptureCall[] {
  return posthog.capture.mock.calls
    .map(([call]) => call as CaptureCall)
    .filter((call) => call.event === event)
}

/** Serves one tool call through a server built and instrumented for `ctx`. */
async function callPantry(caller: McpCallerContext = ctx) {
  const handler = createMcpHandler(() => buildMcpServer(caller), { legacy: 'stateless' })
  const response = await handler.fetch(
    mcpRequest('tools/call', { name: 'get_pantry', arguments: { context: 'Check the milk' } }),
  )
  return readMcpBody<{ isError?: boolean }>(response)
}

describe('MCP analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPosthogMcpServer).mockReturnValue(posthog as never)
    vi.mocked(loadPantry).mockResolvedValue({ items: [], windowDays: 7 } as never)
  })

  it('instruments the server with the MCP PostHog client and the payload filter', () => {
    const server = new McpServer({ name: 't', version: '1' })

    instrumentMcpServer(server, ctx)

    expect(instrumentSpy).toHaveBeenCalledWith(
      server,
      posthog,
      expect.objectContaining({ beforeSend: stripMcpPayload, enableExceptionAutocapture: false }),
    )
  })

  it('wires nothing when there is no PostHog client', () => {
    vi.mocked(getPosthogMcpServer).mockReturnValue(null)

    instrumentMcpServer(new McpServer({ name: 't', version: '1' }), ctx)

    expect(instrumentSpy).not.toHaveBeenCalled()
  })

  it('strips the parameters and the response, and keeps the rest', async () => {
    const event = {
      distinct_id: 'user-1',
      event: '$mcp_tool_call',
      timestamp: '2026-10-11T00:00:00Z',
      type: 'capture' as const,
      properties: {
        $mcp_tool_name: 'list_meals',
        $mcp_parameters: { search: 'gluten free' },
        $mcp_response: { meals: [] },
        $mcp_intent: 'Find a dinner',
        household_id: 'household-1',
      },
    }

    const kept = await stripMcpPayload(event)

    expect(kept?.properties).toEqual({
      $mcp_tool_name: 'list_meals',
      $mcp_intent: 'Find a dinner',
      household_id: 'household-1',
    })
  })

  it('captures one $mcp_tool_call on the user, with the tool and household and no payload', async () => {
    await callPantry()

    await vi.waitFor(() => expect(captures('$mcp_tool_call')).toHaveLength(1))
    const [call] = captures('$mcp_tool_call')
    expect(call!.distinctId).toBe('user-1')
    expect(call!.properties).toMatchObject({
      $mcp_tool_name: 'get_pantry',
      household_id: 'household-1',
    })
    expect(call!.properties).not.toHaveProperty('$mcp_parameters')
    expect(call!.properties).not.toHaveProperty('$mcp_response')
    expect(captures('$exception')).toHaveLength(0)
  })

  it('reports a failed call once, through captureApiError with the real error', async () => {
    const original = new Error('db down')
    vi.mocked(loadPantry).mockRejectedValue(original)

    const body = await callPantry()

    expect(body.result?.isError).toBe(true)
    await vi.waitFor(() => expect(captures('$mcp_tool_call')).toHaveLength(1))
    expect(captures('$mcp_tool_call')[0]!.properties.$mcp_is_error).toBe(true)
    // `captureApiError` sends the one `$exception`; the SDK sends none.
    expect(captures('$exception')).toHaveLength(0)
    expect(captureApiError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(captureApiError).mock.calls[0]![0]).toBe(original)
  })

  it('captures no $exception for a refusal, such as an account without a household', async () => {
    const body = await callPantry({ userId: 'user-2', household: null })

    expect(body.result?.isError).toBe(true)
    await vi.waitFor(() => expect(captures('$mcp_tool_call')).toHaveLength(1))
    expect(captures('$mcp_tool_call')[0]!.properties.$mcp_is_error).toBe(true)
    expect(captures('$exception')).toHaveLength(0)
  })
})
