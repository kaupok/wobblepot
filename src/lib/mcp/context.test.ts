import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))

import { captureApiError } from '@/lib/errors'
import { checkRateLimit } from '@/lib/rate-limit'
import { mcpHousehold, READ_SCOPES, WRITE_SCOPES } from '@/test/mcp'

import {
  defineTool,
  isWriteTool,
  NO_HOUSEHOLD_MESSAGE,
  READ_ONLY_ANNOTATIONS,
  requireWriteScope,
  runTool,
  TOOL_FAILED_MESSAGE,
  ToolInputError,
  WRITE_ANNOTATIONS,
  WRITE_SCOPE_MESSAGE,
} from './context'

const RESET_AT = new Date('2026-10-11T18:00:00.000Z')

const run = vi.fn()
const tool = defineTool({
  name: 'test_tool',
  title: 'Test tool',
  description: 'For tests.',
  inputSchema: z.object({}),
  outputSchema: z.object({ value: z.number() }),
  run,
})

const ctx = { userId: 'user-1', household: mcpHousehold(), scopes: READ_SCOPES }

describe('runTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetAt: RESET_AT,
    })
    run.mockResolvedValue({ value: 42 })
  })

  it('returns the output as compact JSON text and as structuredContent', async () => {
    const result = await runTool(tool, ctx, {})

    expect(result).toEqual({
      content: [{ type: 'text', text: '{"value":42}' }],
      structuredContent: { value: 42 },
    })
    expect(run).toHaveBeenCalledWith(ctx.household, {}, { userId: 'user-1' })
  })

  it('counts each call against the household’s mcp limit', async () => {
    await runTool(tool, ctx, {})

    expect(checkRateLimit).toHaveBeenCalledWith('household-1', 'mcp')
  })

  it('answers with the onboarding message, and runs nothing, without a household', async () => {
    const result = await runTool(
      tool,
      { userId: 'user-1', household: null, scopes: READ_SCOPES },
      {},
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: NO_HOUSEHOLD_MESSAGE }],
    })
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('returns an isError result naming the reset time when the limit blocks', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      limit: 120,
      remaining: 0,
      resetAt: RESET_AT,
    })

    const result = await runTool(tool, ctx, {})

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'This household has made too many requests to Wobblepot. Try again after 2026-10-11T18:00:00.000Z.',
      },
    ])
    expect(run).not.toHaveBeenCalled()
  })

  it('turns a ToolInputError into an isError result with its message', async () => {
    run.mockRejectedValue(new ToolInputError('No such meal.'))

    const result = await runTool(tool, ctx, {})

    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'No such meal.' }] })
  })

  it('reports any other error once and answers with a plain sentence, not the server error', async () => {
    const original = new Error('connection to db.internal:5432 refused')
    run.mockRejectedValue(original)

    const result = await runTool(tool, ctx, {})

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: TOOL_FAILED_MESSAGE }],
    })
    expect(captureApiError).toHaveBeenCalledTimes(1)
    expect(captureApiError).toHaveBeenCalledWith(original, {
      route: '/api/mcp',
      userId: 'user-1',
      householdId: 'household-1',
      feature: 'mcp:test_tool',
    })
  })

  it('reports nothing for a refusal', async () => {
    run.mockRejectedValue(new ToolInputError('No such meal.'))
    await runTool(tool, ctx, {})
    await runTool(tool, { userId: 'user-1', household: null, scopes: READ_SCOPES }, {})

    expect(captureApiError).not.toHaveBeenCalled()
  })

  describe('a write tool', () => {
    const writeTool = defineTool({ ...tool, name: 'write_tool', annotations: WRITE_ANNOTATIONS })

    it('answers a read-only token with the reconnect message, and runs and counts nothing', async () => {
      const result = await runTool(writeTool, ctx, {})

      expect(result).toEqual({
        isError: true,
        content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
      })
      expect(run).not.toHaveBeenCalled()
      expect(checkRateLimit).not.toHaveBeenCalled()
    })

    it('runs for a token with mcp:write, on the shared mcp limit', async () => {
      const result = await runTool(writeTool, { ...ctx, scopes: WRITE_SCOPES }, {})

      expect(result.isError).toBeUndefined()
      expect(run).toHaveBeenCalledOnce()
      expect(checkRateLimit).toHaveBeenCalledWith('household-1', 'mcp')
    })
  })
})

describe('isWriteTool', () => {
  it('treats a tool without annotations as a read', () => {
    expect(isWriteTool({})).toBe(false)
    expect(isWriteTool({ annotations: READ_ONLY_ANNOTATIONS })).toBe(false)
  })

  it('fails closed: annotations without readOnlyHint true mean a write', () => {
    expect(isWriteTool({ annotations: WRITE_ANNOTATIONS })).toBe(true)
    expect(isWriteTool({ annotations: { destructiveHint: false } })).toBe(true)
  })
})

describe('requireWriteScope', () => {
  it('passes a token with mcp:write and refuses one without', () => {
    expect(requireWriteScope({ scopes: WRITE_SCOPES })).toBeNull()
    expect(requireWriteScope({ scopes: READ_SCOPES })?.isError).toBe(true)
    expect(requireWriteScope({ scopes: [] })?.isError).toBe(true)
  })
})
