import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    ingredient: { findMany: vi.fn() },
    pantryItem: { findUnique: vi.fn(), delete: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { runTool, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES, WRITE_SCOPES } from '@/test/mcp'

import { markPurchased } from './mark-purchased'

const household = mcpHousehold({ id: 'household-a' })
const ctx = { userId: 'user-a', household, scopes: WRITE_SCOPES }

const upsert = vi.fn()
const update = vi.fn()

function call(input: Record<string, unknown>, caller = ctx) {
  return runTool(markPurchased, caller, markPurchased.inputSchema.parse(input))
}

function pantryRow(ingredientId: string) {
  return {
    id: `pantry-${ingredientId}`,
    quantity: null,
    lowAt: null,
    isStaple: false,
    updatedAt: new Date('2026-10-12T10:00:00Z'),
    ingredient: { id: ingredientId, name: ingredientId, category: 'dairy', defaultUnit: 'ml' },
  }
}

describe('mark_purchased', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsert.mockImplementation(async ({ create }) => pantryRow(create.ingredientId))
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      (fn as (tx: unknown) => unknown)({ pantryItem: { upsert, update } }),
    )
  })

  it('answers a read-only token with the reconnect message and writes nothing', async () => {
    const result = await call(
      { ingredientIds: ['ing-milk'], purchased: true },
      { ...ctx, scopes: READ_SCOPES },
    )

    expect(result.content).toEqual([{ type: 'text', text: WRITE_SCOPE_MESSAGE }])
    expect(result.isError).toBe(true)
    expect(prisma.ingredient.findMany).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  describe('purchased: true', () => {
    it("puts each ingredient in the caller's pantry, as the purchase route does", async () => {
      vi.mocked(prisma.ingredient.findMany).mockResolvedValue([
        { id: 'ing-milk' },
        { id: 'ing-eggs' },
      ] as never)

      const result = await call({ ingredientIds: ['ing-milk', 'ing-eggs'], purchased: true })

      expect(result.isError).toBeUndefined()
      expect(result.structuredContent).toEqual({
        purchased: true,
        items: [
          { ingredientId: 'ing-milk', outcome: 'in_pantry' },
          { ingredientId: 'ing-eggs', outcome: 'in_pantry' },
        ],
      })
      // Global ingredients and the caller's own, never another household's.
      expect(prisma.ingredient.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['ing-milk', 'ing-eggs'] },
          OR: [{ householdId: null }, { householdId: 'household-a' }],
        },
        select: { id: true },
      })
      expect(upsert).toHaveBeenCalledTimes(2)
      for (const [args] of upsert.mock.calls) {
        expect(args.where.householdId_ingredientId.householdId).toBe('household-a')
        expect(args.create).toMatchObject({
          householdId: 'household-a',
          quantity: null,
          isStaple: false,
        })
      }
    })

    it('writes a repeated id once', async () => {
      vi.mocked(prisma.ingredient.findMany).mockResolvedValue([{ id: 'ing-milk' }] as never)

      const result = await call({ ingredientIds: ['ing-milk', 'ing-milk'], purchased: true })

      expect(upsert).toHaveBeenCalledOnce()
      expect(result.structuredContent).toEqual({
        purchased: true,
        items: [{ ingredientId: 'ing-milk', outcome: 'in_pantry' }],
      })
    })

    it('sets a 0 and a quantity above 0 to "have some", and leaves "have some" as it is', async () => {
      vi.mocked(prisma.ingredient.findMany).mockResolvedValue([
        { id: 'ing-milk' },
        { id: 'ing-rice' },
        { id: 'ing-oil' },
      ] as never)
      const quantities: Record<string, number | null> = {
        'ing-milk': 0,
        'ing-rice': 200,
        'ing-oil': null,
      }
      upsert.mockImplementation(async ({ create }) => ({
        ...pantryRow(create.ingredientId),
        quantity: quantities[create.ingredientId],
      }))
      update.mockImplementation(async ({ where }) => ({
        ...pantryRow(where.id.replace('pantry-', '')),
        quantity: null,
      }))

      const result = await call({
        ingredientIds: ['ing-milk', 'ing-rice', 'ing-oil'],
        purchased: true,
      })

      // The shopping list reads only null as purchased, so a 200 left in place
      // would read the same as an edit on the pantry page (HON-1173, HON-1176).
      expect(update).toHaveBeenCalledTimes(2)
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pantry-ing-milk' },
          data: { quantity: null, lowAt: null },
        }),
      )
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pantry-ing-rice' },
          data: { quantity: null, lowAt: null },
        }),
      )
      // An undo deletes the item, so the result gives the replaced 200 back for
      // the assistant to restore; a 0 ("ran out") is not worth restoring.
      expect(result.structuredContent).toEqual({
        purchased: true,
        items: [
          { ingredientId: 'ing-milk', outcome: 'in_pantry' },
          { ingredientId: 'ing-rice', outcome: 'in_pantry', replacedQuantity: 200 },
          { ingredientId: 'ing-oil', outcome: 'in_pantry' },
        ],
      })
    })

    it("refuses another household's ingredient and writes nothing", async () => {
      // The scoped lookup does not find household B's ingredient.
      vi.mocked(prisma.ingredient.findMany).mockResolvedValue([{ id: 'ing-milk' }] as never)

      const result = await call({ ingredientIds: ['ing-milk', 'ing-of-b'], purchased: true })

      expect(result.isError).toBe(true)
      expect(result.content[0]).toMatchObject({ text: expect.stringContaining('ing-of-b') })
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('rejects an empty list', () => {
      expect(() =>
        markPurchased.inputSchema.parse({ ingredientIds: [], purchased: true }),
      ).toThrow()
    })
  })

  describe('purchased: false', () => {
    it("takes a recent purchase out of the caller's pantry, as the unpurchase route does", async () => {
      vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue({
        id: 'pantry-1',
        isStaple: false,
        quantity: null,
        updatedAt: new Date(),
      } as never)

      const result = await call({ ingredientIds: ['ing-milk'], purchased: false })

      expect(result.structuredContent).toEqual({
        purchased: false,
        items: [{ ingredientId: 'ing-milk', outcome: 'removed' }],
      })
      expect(prisma.pantryItem.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            householdId_ingredientId: { householdId: 'household-a', ingredientId: 'ing-milk' },
          },
        }),
      )
      expect(prisma.pantryItem.delete).toHaveBeenCalledWith({ where: { id: 'pantry-1' } })
    })

    it('removes a "ran out" item, because quantity 0 holds nothing the household would lose', async () => {
      vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue({
        id: 'pantry-milk',
        isStaple: false,
        quantity: 0,
        updatedAt: new Date(),
      } as never)

      const result = await call({ ingredientIds: ['ing-milk'], purchased: false })

      expect(result.structuredContent).toEqual({
        purchased: false,
        items: [{ ingredientId: 'ing-milk', outcome: 'removed' }],
      })
      expect(prisma.pantryItem.delete).toHaveBeenCalledWith({ where: { id: 'pantry-milk' } })
    })

    it('reports each item it leaves in place, and deletes none of them', async () => {
      const old = new Date()
      old.setDate(old.getDate() - 8)
      vi.mocked(prisma.pantryItem.findUnique)
        .mockResolvedValueOnce({
          id: 'p-staple',
          isStaple: true,
          quantity: null,
          updatedAt: new Date(),
        } as never)
        .mockResolvedValueOnce({
          id: 'p-old',
          isStaple: false,
          quantity: null,
          updatedAt: old,
        } as never)
        // A quantity the household entered, touched by a recent purchase.
        .mockResolvedValueOnce({
          id: 'p-flour',
          isStaple: false,
          quantity: 1000,
          updatedAt: new Date(),
        } as never)
        // Household B's pantry row is not found under household A's key.
        .mockResolvedValueOnce(null)

      const result = await call({
        ingredientIds: ['ing-salt', 'ing-rice', 'ing-flour', 'ing-of-b'],
        purchased: false,
      })

      expect(result.structuredContent).toEqual({
        purchased: false,
        items: [
          { ingredientId: 'ing-salt', outcome: 'ran_out' },
          { ingredientId: 'ing-rice', outcome: 'too_old' },
          { ingredientId: 'ing-flour', outcome: 'has_quantity' },
          { ingredientId: 'ing-of-b', outcome: 'not_in_pantry' },
        ],
      })
      expect(prisma.pantryItem.delete).not.toHaveBeenCalled()
      // The staple stays, back at ran out, so it is on the list again (HON-1398).
      expect(prisma.pantryItem.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'p-staple' },
        data: { quantity: 0, lowAt: null },
      })
    })

    it('keeps only the items named in restoreLowIds, low again, and undoes the rest (HON-1586)', async () => {
      vi.mocked(prisma.pantryItem.findUnique)
        .mockResolvedValueOnce({
          id: 'pantry-milk',
          isStaple: false,
          quantity: null,
          updatedAt: new Date(),
        } as never)
        .mockResolvedValueOnce({
          id: 'pantry-onion',
          isStaple: false,
          quantity: null,
          updatedAt: new Date(),
        } as never)

      const result = await call({
        ingredientIds: ['ing-milk', 'ing-onion'],
        purchased: false,
        restoreLowIds: ['ing-onion'],
      })

      expect(result.structuredContent).toEqual({
        purchased: false,
        items: [
          { ingredientId: 'ing-milk', outcome: 'removed' },
          { ingredientId: 'ing-onion', outcome: 'restored' },
        ],
      })
      expect(prisma.pantryItem.delete).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'pantry-milk' },
      })
      expect(prisma.pantryItem.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'pantry-onion' },
        data: { lowAt: expect.any(Date) },
      })
    })
  })

  it('reports replacedLow for an item the purchase took off running low (HON-1586)', async () => {
    vi.mocked(prisma.ingredient.findMany).mockResolvedValue([{ id: 'ing-onion' }] as never)
    upsert.mockImplementation(async ({ create }) => ({
      ...pantryRow(create.ingredientId),
      lowAt: new Date('2026-10-31T18:00:00Z'),
    }))
    update.mockImplementation(async ({ where }) => pantryRow(where.id.replace('pantry-', '')))

    const result = await call({ ingredientIds: ['ing-onion'], purchased: true })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pantry-ing-onion' },
        data: { quantity: null, lowAt: null },
      }),
    )
    expect(result.structuredContent).toEqual({
      purchased: true,
      items: [{ ingredientId: 'ing-onion', outcome: 'in_pantry', replacedLow: true }],
    })
  })
})
