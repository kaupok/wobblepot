import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_STAPLE_NAMES, seedDefaultStaples } from './default-staples'

function mockTx({
  ingredients,
  existing = [],
}: {
  ingredients: { id: string }[]
  existing?: { ingredientId: string }[]
}) {
  return {
    ingredient: { findMany: vi.fn().mockResolvedValue(ingredients) },
    pantryItem: {
      findMany: vi.fn().mockResolvedValue(existing),
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    },
  }
}

describe('DEFAULT_STAPLE_NAMES', () => {
  it('is salt, black pepper and water', () => {
    expect(DEFAULT_STAPLE_NAMES).toEqual(['salt', 'black pepper', 'water'])
  })
})

describe('seedDefaultStaples', () => {
  it('looks up the global ingredients by name', async () => {
    const tx = mockTx({ ingredients: [] })

    await seedDefaultStaples(tx as never, 'household-1')

    expect(tx.ingredient.findMany).toHaveBeenCalledWith({
      where: { name: { in: ['salt', 'black pepper', 'water'] }, householdId: null },
      select: { id: true },
    })
  })

  it('creates a staple row with no quantity for each default staple', async () => {
    const tx = mockTx({ ingredients: [{ id: 'salt' }, { id: 'pepper' }, { id: 'water' }] })

    const created = await seedDefaultStaples(tx as never, 'household-1')

    expect(created).toBe(3)
    expect(tx.pantryItem.createMany).toHaveBeenCalledWith({
      data: ['salt', 'pepper', 'water'].map((ingredientId) => ({
        householdId: 'household-1',
        ingredientId,
        isStaple: true,
        quantity: null,
      })),
      skipDuplicates: true,
    })
  })

  it('leaves an existing pantry row alone', async () => {
    const tx = mockTx({
      ingredients: [{ id: 'salt' }, { id: 'pepper' }, { id: 'water' }],
      existing: [{ ingredientId: 'salt' }],
    })

    const created = await seedDefaultStaples(tx as never, 'household-1')

    expect(created).toBe(2)
    expect(tx.pantryItem.findMany).toHaveBeenCalledWith({
      where: { householdId: 'household-1', ingredientId: { in: ['salt', 'pepper', 'water'] } },
      select: { ingredientId: true },
    })
    const { data } = tx.pantryItem.createMany.mock.calls[0]![0] as {
      data: { ingredientId: string }[]
    }
    expect(data.map((d) => d.ingredientId)).toEqual(['pepper', 'water'])
  })

  it('skips an ingredient missing from the global pool', async () => {
    const tx = mockTx({ ingredients: [{ id: 'salt' }, { id: 'water' }] })

    const created = await seedDefaultStaples(tx as never, 'household-1')

    expect(created).toBe(2)
    const { data } = tx.pantryItem.createMany.mock.calls[0]![0] as {
      data: { ingredientId: string }[]
    }
    expect(data.map((d) => d.ingredientId)).toEqual(['salt', 'water'])
  })

  it('writes nothing when no default staple exists', async () => {
    const tx = mockTx({ ingredients: [] })

    expect(await seedDefaultStaples(tx as never, 'household-1')).toBe(0)
    expect(tx.pantryItem.findMany).not.toHaveBeenCalled()
    expect(tx.pantryItem.createMany).not.toHaveBeenCalled()
  })

  it('writes nothing when every staple is already present', async () => {
    const tx = mockTx({
      ingredients: [{ id: 'salt' }],
      existing: [{ ingredientId: 'salt' }],
    })

    expect(await seedDefaultStaples(tx as never, 'household-1')).toBe(0)
    expect(tx.pantryItem.createMany).not.toHaveBeenCalled()
  })
})
