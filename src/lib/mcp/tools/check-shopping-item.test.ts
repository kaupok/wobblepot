import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    customShoppingItem: { findUnique: vi.fn() },
    ingredient: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { runTool, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES, WRITE_SCOPES } from '@/test/mcp'

import { checkShoppingItem } from './check-shopping-item'

const household = mcpHousehold({ id: 'household-a' })
const ctx = { userId: 'user-a', household, scopes: WRITE_SCOPES }

const update = vi.fn()
const upsert = vi.fn()
const pantryUpdate = vi.fn()

function call(input: Record<string, unknown>, caller = ctx) {
  return runTool(checkShoppingItem, caller, checkShoppingItem.inputSchema.parse(input))
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'custom-1',
    householdId: 'household-a',
    name: 'Oat milk',
    ingredientId: 'ing-oat-milk',
    checked: false,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('check_shopping_item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsert.mockResolvedValue({ id: 'pantry-oat-milk', quantity: null, lowAt: null })
    update.mockImplementation(async ({ data }) => ({ ...item(), ...data, ingredient: null }))
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      (fn as (tx: unknown) => unknown)({
        customShoppingItem: { update },
        pantryItem: { upsert, update: pantryUpdate },
      }),
    )
  })

  it('answers a read-only token with the reconnect message and writes nothing', async () => {
    const result = await call({ id: 'custom-1', checked: true }, { ...ctx, scopes: READ_SCOPES })

    expect(result.content).toEqual([{ type: 'text', text: WRITE_SCOPE_MESSAGE }])
    expect(prisma.customShoppingItem.findUnique).not.toHaveBeenCalled()
  })

  it("checks off a linked item and stocks the caller's pantry, as the custom-item route does", async () => {
    vi.mocked(prisma.customShoppingItem.findUnique).mockResolvedValue(item() as never)

    const result = await call({ id: 'custom-1', checked: true })

    expect(result.structuredContent).toEqual({
      item: { id: 'custom-1', name: 'Oat milk', checked: true },
    })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'custom-1' }, data: { checked: true } }),
    )
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          householdId_ingredientId: { householdId: 'household-a', ingredientId: 'ing-oat-milk' },
        },
        create: {
          householdId: 'household-a',
          ingredientId: 'ing-oat-milk',
          quantity: null,
          isStaple: false,
        },
      }),
    )
  })

  it('returns the pantry quantity that checking off a linked item replaced (HON-1176)', async () => {
    vi.mocked(prisma.customShoppingItem.findUnique).mockResolvedValue(item() as never)
    upsert.mockResolvedValue({ id: 'pantry-oat-milk', quantity: 2000, lowAt: null })

    const result = await call({ id: 'custom-1', checked: true })

    // Unchecking does not restore it, so the assistant gets it back to set.
    expect(pantryUpdate).toHaveBeenCalledWith({
      where: { id: 'pantry-oat-milk' },
      data: { quantity: null, lowAt: null },
    })
    expect(result.structuredContent).toEqual({
      item: { id: 'custom-1', name: 'Oat milk', checked: true },
      replacedQuantity: 2000,
    })
  })

  it('unchecks an item without touching the pantry', async () => {
    vi.mocked(prisma.customShoppingItem.findUnique).mockResolvedValue(
      item({ checked: true }) as never,
    )

    const result = await call({ id: 'custom-1', checked: false })

    expect(result.structuredContent).toEqual({
      item: { id: 'custom-1', name: 'Oat milk', checked: false },
    })
    expect(upsert).not.toHaveBeenCalled()
  })

  it("refuses another household's item as not found and writes nothing", async () => {
    vi.mocked(prisma.customShoppingItem.findUnique).mockResolvedValue(
      item({ householdId: 'household-b' }) as never,
    )

    const result = await call({ id: 'custom-1', checked: true })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('No item with this id'),
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
