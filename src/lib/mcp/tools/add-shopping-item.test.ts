import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    customShoppingItem: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES, WRITE_SCOPES } from '@/test/mcp'
import { runTool, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { addShoppingItem } from './add-shopping-item'

const household = mcpHousehold({ id: 'household-a' })
const ctx = { userId: 'user-a', household, scopes: WRITE_SCOPES }

function call(input: Record<string, unknown>, caller = ctx) {
  return runTool(addShoppingItem, caller, addShoppingItem.inputSchema.parse(input))
}

const ITEM = {
  id: 'custom-1',
  householdId: 'household-a',
  name: 'Dish soap',
  ingredientId: null,
  checked: false,
  createdAt: new Date(),
  ingredient: null,
}

describe('add_shopping_item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
  })

  it('answers a read-only token with the reconnect message and writes nothing', async () => {
    const result = await call({ name: 'Dish soap' }, { ...ctx, scopes: READ_SCOPES })

    expect(result.content).toEqual([{ type: 'text', text: WRITE_SCOPE_MESSAGE }])
    expect(prisma.customShoppingItem.create).not.toHaveBeenCalled()
  })

  it("creates the item on the caller's list, as the custom-item route does", async () => {
    vi.mocked(prisma.customShoppingItem.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: 'ing-soap', similarity: 0.9 }] as never)
    vi.mocked(prisma.customShoppingItem.create).mockResolvedValue(ITEM as never)

    const result = await call({ name: '  Dish soap ' })

    expect(result.structuredContent).toEqual({
      outcome: 'added',
      item: { id: 'custom-1', name: 'Dish soap', checked: false },
    })
    // The name is trimmed, and the duplicate check is the caller's household.
    expect(prisma.customShoppingItem.findUnique).toHaveBeenCalledWith({
      where: { householdId_name: { householdId: 'household-a', name: 'Dish soap' } },
    })
    expect(prisma.customShoppingItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { householdId: 'household-a', name: 'Dish soap', ingredientId: 'ing-soap' },
      }),
    )
    // The ingredient match is limited to global and the caller's own ingredients.
    const [, ...values] = vi.mocked(prisma.$queryRaw).mock.calls[0]!
    expect(values).toContain('household-a')
  })

  it('puts a checked item back on the list', async () => {
    vi.mocked(prisma.customShoppingItem.findUnique).mockResolvedValue({
      ...ITEM,
      checked: true,
    } as never)
    vi.mocked(prisma.customShoppingItem.update).mockResolvedValue(ITEM as never)

    const result = await call({ name: 'Dish soap' })

    expect(result.structuredContent).toEqual({
      outcome: 'back_on_list',
      item: { id: 'custom-1', name: 'Dish soap', checked: false },
    })
    expect(prisma.customShoppingItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'custom-1' }, data: { checked: false } }),
    )
  })

  it('changes nothing for an item already on the list', async () => {
    vi.mocked(prisma.customShoppingItem.findUnique).mockResolvedValue(ITEM as never)

    const result = await call({ name: 'Dish soap' })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toMatchObject({ outcome: 'already_on_list' })
    expect(prisma.customShoppingItem.create).not.toHaveBeenCalled()
    expect(prisma.customShoppingItem.update).not.toHaveBeenCalled()
  })

  it('rejects an empty name', () => {
    expect(() => addShoppingItem.inputSchema.parse({ name: '   ' })).toThrow()
  })
})
