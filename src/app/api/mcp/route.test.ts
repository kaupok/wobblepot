import { describe, it, expect, vi, beforeEach } from 'vitest'

const { ORIGIN } = vi.hoisted(() => ({ ORIGIN: 'http://localhost:3000' }))

vi.mock('@/lib/auth', () => ({
  auth: {
    options: {},
    $context: Promise.resolve({ baseURL: `${ORIGIN}/api/auth`, internalAdapter: {} }),
  },
}))
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  getServerBaseURL: () => ORIGIN,
}))
vi.mock('@better-auth/mcp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@better-auth/mcp')>()
  return { ...actual, requireMcpAuth: vi.fn(actual.requireMcpAuth) }
})
// The account and grant read is `loadMcpCaller`, tested against a database
// in `grant.db.test.ts`; the tools' queries are tested next to each tool. This
// file mocks those modules at the seam (HON-1217).
vi.mock('@/lib/mcp/grant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/grant')>()),
  loadMcpCaller: vi.fn(),
}))
vi.mock('@/lib/shopping/purchase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shopping/purchase')>()),
  purchaseIngredients: vi.fn(),
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }))
vi.mock('@/lib/errors', () => ({ captureApiError: vi.fn() }))
vi.mock('@/lib/meal-planning/load-plan-entries', () => ({ loadPlanEntries: vi.fn() }))
vi.mock('@/lib/day-extras/day-extras', () => ({ loadDayExtras: vi.fn(async () => []) }))
vi.mock('@/lib/shopping/load-shopping-list', () => ({ loadShoppingList: vi.fn() }))
vi.mock('@/lib/meal-planning/load-pantry', () => ({ loadPantry: vi.fn() }))
vi.mock('@/lib/household/members', () => ({ listMembersForAssistant: vi.fn(async () => []) }))
vi.mock('@/lib/household/excluded-ingredients', () => ({
  matchExcludedIngredients: vi.fn(async () => []),
}))
vi.mock('@/lib/meals/load-meals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meals/load-meals')>()),
  loadMeals: vi.fn(),
}))

import { requireMcpAuth } from '@better-auth/mcp'
import { loadMcpCaller, McpGrantError } from '@/lib/mcp/grant'
import { purchaseIngredients } from '@/lib/shopping/purchase'
import { checkRateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/errors'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { loadMeals } from '@/lib/meals/load-meals'
import { listMembersForAssistant } from '@/lib/household/members'
import { NO_HOUSEHOLD_MESSAGE, TOOL_FAILED_MESSAGE, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import {
  legacyMcpRequest,
  mcpHousehold,
  mcpRequest,
  readMcpBody,
  type McpToolResultBody,
} from '@/test/mcp'
import { GET, OPTIONS, POST } from './route'
import { WRITE_TOOL_ARGS } from './route.fixtures'

const actualRequireMcpAuth = vi.mocked(requireMcpAuth).getMockImplementation()!

const HOUSEHOLDS = {
  'user-a': mcpHousehold({ id: 'household-a', name: 'A' }),
  'user-b': mcpHousehold({ id: 'household-b', name: 'B' }),
}

const TOKEN_IAT = Date.parse('2026-10-12T12:00:10Z') / 1000

const READ_TOOL_NAMES = [
  'get_meal_plan',
  'get_shopping_list',
  'get_pantry',
  'list_meals',
  'get_meal',
  'get_household',
]
const WRITE_TOOL_NAMES = Object.keys(WRITE_TOOL_ARGS)

interface ListedTool {
  name: string
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  inputSchema?: unknown
  outputSchema?: unknown
}

/**
 * Stands in for the token check: the bearer value is the user id, so a test
 * picks the caller with a header. `<user>:write` adds the `mcp:write` scope.
 * The real wrapper's challenge is covered by the first test, which leaves it
 * in place.
 */
function acceptBearerAsUserId() {
  vi.mocked(requireMcpAuth).mockImplementation((_auth, handler) => async (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '')
    if (!token) return new Response(null, { status: 401 })
    const [sub, access] = token.split(':')
    return handler(request, {
      sub,
      scope: access === 'write' ? 'openid mcp:read mcp:write' : 'openid mcp:read',
      azp: 'client-1',
      iat: TOKEN_IAT,
    })
  })
}

function as(userId: string) {
  return { authorization: `Bearer ${userId}` }
}

/** The caller with a token the user allowed to make changes. */
function asWriter(userId: string) {
  return { authorization: `Bearer ${userId}:write` }
}

async function callTool(
  userId: string,
  name: string,
  args: Record<string, unknown> = {},
  headers = as(userId),
) {
  const response = await POST(mcpRequest('tools/call', { name, arguments: args }, headers))
  expect(response.status).toBe(200)
  const body = await readMcpBody<McpToolResultBody>(response)
  expect(body.error).toBeUndefined()
  return body.result!
}

describe('/api/mcp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireMcpAuth).mockImplementation(actualRequireMcpAuth)
    vi.mocked(loadMcpCaller).mockImplementation(async ({ userId, scopes }) => ({
      userId,
      household: HOUSEHOLDS[userId as keyof typeof HOUSEHOLDS] ?? null,
      scopes,
    }))
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetAt: new Date(),
    })
    vi.mocked(loadPlanEntries).mockImplementation(async (household) => ({
      planId: `plan-${household.id}`,
      entries: [
        {
          id: `entry-${household.id}`,
          date: '2026-10-12',
          mealType: 'dinner',
          status: 'planned',
          kind: 'meal',
          items: [],
          servingOverride: null,
          meal: { id: `meal-${household.id}`, name: `Dinner of ${household.id}` },
        },
      ] as never,
    }))
  })

  it('answers a request without a token with 401 and the protected-resource challenge', async () => {
    const response = await POST(mcpRequest('tools/list'))

    expect(response.status).toBe(401)
    const challenge = response.headers.get('www-authenticate')
    expect(challenge).toMatch(/^Bearer /)
    expect(challenge).toContain(`${ORIGIN}/.well-known/oauth-protected-resource`)
    // Browser clients read the challenge cross-origin.
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate')
  })

  it('verifies tokens against this resource, the root issuer and mcp:read', async () => {
    await POST(mcpRequest('tools/list'))

    expect(requireMcpAuth).toHaveBeenCalledWith(expect.anything(), expect.any(Function), {
      resource: `${ORIGIN}/api/mcp`,
      issuer: ORIGIN,
      jwksUrl: `${ORIGIN}/api/auth/jwks`,
      requiredScopes: ['mcp:read'],
      challengeScopes: ['mcp:read', 'mcp:write'],
    })
  })

  it('asks for the read and write scopes in the 401 challenge, so a client can request both', async () => {
    const response = await POST(mcpRequest('tools/list'))

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('scope="mcp:read mcp:write"')
  })

  describe('with a valid token', () => {
    beforeEach(acceptBearerAsUserId)

    it.each([
      ['a read-only token', as('user-a')],
      ['a read and write token', asWriter('user-a')],
    ])(
      'lists the six read tools and the thirteen write tools for %s, each with both schemas',
      async (_label, headers) => {
        const response = await POST(mcpRequest('tools/list', {}, headers))
        const body = await readMcpBody<{ tools: ListedTool[] }>(response)

        const tools = body.result!.tools
        expect(tools.map((tool) => tool.name).sort()).toEqual(
          [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].sort(),
        )
        for (const tool of tools) {
          expect(tool.inputSchema).toMatchObject({ type: 'object' })
          expect(tool.outputSchema).toMatchObject({ type: 'object' })
        }
        const annotations = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]))
        for (const name of READ_TOOL_NAMES) {
          expect(annotations[name]).toEqual({
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false,
          })
        }
        const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
        expect(annotations.mark_purchased).toEqual({ ...write, idempotentHint: true })
        expect(annotations.check_shopping_item).toEqual({ ...write, idempotentHint: true })
        expect(annotations.set_pantry_status).toEqual({ ...write, idempotentHint: true })
        expect(annotations.add_shopping_item).toEqual({ ...write, idempotentHint: false })
        expect(annotations.rate_meal).toEqual({ ...write, idempotentHint: true })
        expect(annotations.swap_meal).toEqual({ ...write, idempotentHint: false })
        expect(annotations.adjust_meal).toEqual({ ...write, idempotentHint: false })
        expect(annotations.create_meal).toEqual({ ...write, idempotentHint: false })
        expect(annotations.update_meal).toEqual({ ...write, idempotentHint: true })
        expect(annotations.plan_meal).toEqual({ ...write, idempotentHint: false })
        expect(annotations.plan_fridge_meal).toEqual({ ...write, idempotentHint: false })
        expect(annotations.add_extra).toEqual({ ...write, idempotentHint: false })
        expect(annotations.remove_extra).toEqual({ ...write, idempotentHint: false })
        expect(annotations.clear_meal).toEqual({
          ...write,
          destructiveHint: true,
          idempotentHint: false,
        })
        expect(annotations.set_meal_status).toEqual({ ...write, idempotentHint: true })
        expect(annotations.set_meal_servings).toEqual({ ...write, idempotentHint: true })
        // Listing is discovery, not a tool call, so it is not rate-limited.
        expect(checkRateLimit).not.toHaveBeenCalled()
      },
    )

    it.each(WRITE_TOOL_NAMES)(
      'answers %s for a read-only token with the reconnect message',
      async (name) => {
        const result = await callTool('user-a', name, WRITE_TOOL_ARGS[name])

        expect(result.isError).toBe(true)
        expect(result.content).toEqual([{ type: 'text', text: WRITE_SCOPE_MESSAGE }])
        expect(checkRateLimit).not.toHaveBeenCalled()
      },
    )

    it("runs a write tool for a token with mcp:write, on the caller's household", async () => {
      // No ingredient found, so the purchase stops before any write.
      vi.mocked(purchaseIngredients).mockResolvedValue({
        status: 'invalid_ids',
        invalidIds: ['ing-1'],
      })

      const result = await callTool(
        'user-b',
        'mark_purchased',
        { ingredientIds: ['ing-1'], purchased: true },
        asWriter('user-b'),
      )

      expect(result.content[0]!.text).toContain('ing-1')
      expect(result.content[0]!.text).not.toBe(WRITE_SCOPE_MESSAGE)
      expect(checkRateLimit).toHaveBeenCalledWith('household-b', 'mcp')
      expect(vi.mocked(purchaseIngredients).mock.calls).toEqual([[HOUSEHOLDS['user-b'], ['ing-1']]])
    })

    it('serves a 2025-era client that sends no per-request envelope', async () => {
      const response = await POST(legacyMcpRequest('tools/list', {}, as('user-a')))

      expect(response.status).toBe(200)
      const body = await readMcpBody<{ tools: ListedTool[] }>(response)
      expect(body.result!.tools).toHaveLength(READ_TOOL_NAMES.length + WRITE_TOOL_NAMES.length)
    })

    it('sends the app icon, website and description in the initialize handshake', async () => {
      const response = await POST(
        legacyMcpRequest(
          'initialize',
          {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
          as('user-a'),
        ),
      )

      expect(response.status).toBe(200)
      const body = await readMcpBody<{ serverInfo: Record<string, unknown> }>(response)
      expect(body.error).toBeUndefined()
      expect(body.result!.serverInfo).toEqual({
        // `@posthog/mcp` reports `name` and `version` on every event.
        name: 'wobblepot',
        title: 'Wobblepot',
        version: '1.0.0',
        description: "Wobblepot is the household's meal planner.",
        websiteUrl: ORIGIN,
        icons: [
          { src: `${ORIGIN}/icons/icon-192x192.png`, mimeType: 'image/png', sizes: ['192x192'] },
          { src: `${ORIGIN}/icons/icon-512x512.png`, mimeType: 'image/png', sizes: ['512x512'] },
        ],
      })
    })

    it("returns each caller only their own household's data", async () => {
      const a = await callTool('user-a', 'get_meal_plan', { from: '2026-10-12', to: '2026-10-12' })
      const b = await callTool('user-b', 'get_meal_plan', { from: '2026-10-12', to: '2026-10-12' })

      expect(JSON.stringify(a.structuredContent)).toContain('Dinner of household-a')
      expect(JSON.stringify(a.structuredContent)).not.toContain('household-b')
      expect(JSON.stringify(b.structuredContent)).toContain('Dinner of household-b')
      expect(JSON.stringify(b.structuredContent)).not.toContain('household-a')
      expect(vi.mocked(loadPlanEntries).mock.calls.map(([household]) => household.id)).toEqual([
        'household-a',
        'household-b',
      ])
      expect(vi.mocked(checkRateLimit).mock.calls).toEqual([
        ['household-a', 'mcp'],
        ['household-b', 'mcp'],
      ])
    })

    it("answers get_household for a read-only token with the caller's household", async () => {
      const result = await callTool('user-b', 'get_household')

      expect(result.isError).toBeUndefined()
      expect(result.structuredContent).toMatchObject({ household: { name: 'B' } })
      expect(vi.mocked(listMembersForAssistant).mock.calls).toEqual([['household-b']])
    })

    it('passes the caller’s household to every loader', async () => {
      vi.mocked(loadShoppingList).mockResolvedValue({ groups: [], customItems: [] } as never)
      vi.mocked(loadPantry).mockResolvedValue({ items: [], windowDays: 7 } as never)
      vi.mocked(loadMeals).mockResolvedValue({ meals: [], total: 0, hasMore: false })

      await callTool('user-b', 'get_shopping_list')
      await callTool('user-b', 'get_pantry')
      await callTool('user-b', 'list_meals')

      expect(vi.mocked(loadShoppingList).mock.calls[0]![0].id).toBe('household-b')
      expect(vi.mocked(loadPantry).mock.calls[0]![0].id).toBe('household-b')
      expect(vi.mocked(loadMeals).mock.calls[0]![0].id).toBe('household-b')
      // `get_meal` queries on its own; `get-meal.test.ts` covers its household scoping.
    })

    it('answers every tool with the onboarding message for an account without a household', async () => {
      const args: Record<string, Record<string, unknown>> = { get_meal: { mealId: 'meal-1' } }

      for (const name of READ_TOOL_NAMES) {
        const result = await callTool('user-without-household', name, args[name] ?? {})
        expect(result.isError, name).toBe(true)
        expect(result.content, name).toEqual([{ type: 'text', text: NO_HOUSEHOLD_MESSAGE }])
      }
    })

    it('sends a plain sentence, not the server error, when a tool fails', async () => {
      vi.mocked(loadPantry).mockRejectedValue(new Error('relation "pantry_item" does not exist'))

      const result = await callTool('user-a', 'get_pantry')

      expect(result.isError).toBe(true)
      expect(result.content).toEqual([{ type: 'text', text: TOOL_FAILED_MESSAGE }])
      expect(captureApiError).toHaveBeenCalledTimes(1)
      expect(captureApiError).toHaveBeenCalledWith(expect.any(Error), {
        route: '/api/mcp',
        userId: 'user-a',
        householdId: 'household-a',
        feature: 'mcp:get_pantry',
      })
    })

    it('loads the caller from the token claims', async () => {
      await POST(mcpRequest('tools/list', {}, asWriter('user-a')))

      expect(loadMcpCaller).toHaveBeenCalledWith({
        userId: 'user-a',
        clientId: 'client-1',
        issuedAt: TOKEN_IAT,
        scopes: ['openid', 'mcp:read', 'mcp:write'],
      })
    })

    it.each([
      ['noAccount', 'no active account'],
      ['noGrant', 'no active grant'],
    ] as const)(
      'refuses a token whose grant is gone (%s) with 401',
      async (reason, description) => {
        vi.mocked(loadMcpCaller).mockRejectedValue(new McpGrantError(reason))

        const response = await POST(mcpRequest('tools/list', {}, as('user-a')))

        expect(response.status).toBe(401)
        const challenge = response.headers.get('www-authenticate')
        expect(challenge).toContain('error="invalid_token"')
        expect(challenge).toContain(`error_description="${description}"`)
        expect(challenge).toContain(
          'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"',
        )
        expect(captureApiError).not.toHaveBeenCalled()
      },
    )

    it('reports a failed account lookup and answers 500 without the server error', async () => {
      vi.mocked(loadMcpCaller).mockRejectedValue(new Error('db down'))

      const response = await POST(mcpRequest('tools/list', {}, as('user-a')))

      expect(response.status).toBe(500)
      expect(await response.text()).not.toContain('db down')
      expect(captureApiError).toHaveBeenCalledWith(expect.any(Error), {
        route: '/api/mcp',
        userId: 'user-a',
      })
    })
  })

  it('reports a failure outside any tool and answers a JSON-RPC 500', async () => {
    vi.mocked(requireMcpAuth).mockImplementation(() => async () => {
      throw new Error('JWKS unreachable')
    })

    const response = await POST(mcpRequest('tools/list'))

    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('JWKS')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(captureApiError).toHaveBeenCalledWith(expect.any(Error), { route: '/api/mcp' })
  })

  it('answers GET with 405, because stateless serving opens no stream', async () => {
    const response = GET()

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST, OPTIONS')
  })

  it('answers the CORS preflight', () => {
    const response = OPTIONS()

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    const allowed = response.headers
      .get('access-control-allow-headers')!
      .split(',')
      .map((name) => name.trim().toLowerCase())
    // Every header a 2026-07-28 request carries that is not CORS-safelisted.
    for (const name of ['authorization', 'mcp-protocol-version', 'mcp-method', 'mcp-name']) {
      expect(allowed, name).toContain(name)
    }
  })
})
