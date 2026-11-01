import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    ingredient: { findFirst: vi.fn() },
    pantryItem: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))

import { Prisma } from '@/generated/prisma/client'
import { runTool, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { prisma } from '@/lib/prisma'
import { mcpHousehold, READ_SCOPES, WRITE_SCOPES } from '@/test/mcp'

import { setPantryStatus } from './set-pantry-status'

const household = mcpHousehold({ id: 'household-a' })
const ctx = { userId: 'user-a', household, scopes: WRITE_SCOPES }

function call(input: Record<string, unknown>, caller = ctx) {
  return runTool(setPantryStatus, caller, setPantryStatus.inputSchema.parse(input))
}

const MILK = {
  id: 'ing-milk',
  name: 'Milk',
  category: 'dairy',
  defaultUnit: 'g',
  measuredByVolume: true,
}

/** The ingredient select both pantry routes send (route.test.ts files). */
const INCLUDE = {
  ingredient: {
    select: {
      id: true,
      name: true,
      category: true,
      defaultUnit: true,
      measuredByVolume: true,
    },
  },
}

function pantryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pantry-1',
    householdId: 'household-a',
    ingredientId: 'ing-milk',
    quantity: 500,
    isStaple: false,
    expiresAt: null,
    lowAt: null,
    updatedAt: new Date('2026-10-01'),
    ...overrides,
  }
}

describe('set_pantry_status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.ingredient.findFirst).mockResolvedValue(MILK as never)
    vi.mocked(prisma.pantryItem.create).mockImplementation((async ({ data }: never) => ({
      ...pantryRow(),
      ...(data as object),
      ingredient: MILK,
    })) as never)
    vi.mocked(prisma.pantryItem.update).mockImplementation((async ({ data }: never) => ({
      ...pantryRow(),
      ...(data as object),
      ingredient: MILK,
    })) as never)
  })

  it('answers a read-only token with the reconnect message and writes nothing', async () => {
    const result = await call(
      { ingredientId: 'ing-milk', status: 'have_some' },
      {
        ...ctx,
        scopes: READ_SCOPES,
      },
    )

    expect(result.content).toEqual([{ type: 'text', text: WRITE_SCOPE_MESSAGE }])
    expect(prisma.ingredient.findFirst).not.toHaveBeenCalled()
    expect(prisma.pantryItem.create).not.toHaveBeenCalled()
    expect(prisma.pantryItem.update).not.toHaveBeenCalled()
  })

  it.each([
    ['have_some', null],
    ['ran_out', 0],
  ])(
    "creates a pantry item in the caller's household for %s with quantity %s, as POST /api/pantry does",
    async (status, quantity) => {
      vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue(null)

      const result = await call({ ingredientId: 'ing-milk', status })

      expect(result.structuredContent).toEqual({
        outcome: 'created',
        item: {
          ingredientId: 'ing-milk',
          name: 'Milk',
          quantity,
          unit: 'ml',
          isStaple: false,
          low: false,
        },
      })
      expect(prisma.ingredient.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ing-milk', OR: [{ householdId: null }, { householdId: 'household-a' }] },
        }),
      )
      expect(prisma.pantryItem.findUnique).toHaveBeenCalledWith({
        where: {
          householdId_ingredientId: { householdId: 'household-a', ingredientId: 'ing-milk' },
        },
      })
      expect(prisma.pantryItem.create).toHaveBeenCalledWith({
        data: { householdId: 'household-a', ingredientId: 'ing-milk', quantity, isStaple: false },
        include: INCLUDE,
      })
      expect(prisma.pantryItem.update).not.toHaveBeenCalled()
    },
  )

  // Both clear a running-low mark (HON-1586): `have_some` with `low: false`,
  // `ran_out` through quantity 0.
  it.each([
    ['have_some', null],
    ['ran_out', 0],
  ])(
    'updates only the quantity of an existing item for %s to %s, as PATCH /api/pantry/[id] does',
    async (status, quantity) => {
      // An amount from before HON-1201, so both statuses change the row.
      vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue(pantryRow() as never)
      vi.mocked(prisma.pantryItem.findFirst).mockResolvedValue(pantryRow() as never)

      const result = await call({ ingredientId: 'ing-milk', status })

      expect(result.structuredContent).toEqual({
        outcome: 'updated',
        item: {
          ingredientId: 'ing-milk',
          name: 'Milk',
          quantity,
          unit: 'ml',
          isStaple: false,
          low: false,
        },
      })
      // The update is scoped to the caller's household, so another
      // household's pantry is never read or written.
      expect(prisma.pantryItem.findFirst).toHaveBeenCalledWith({
        where: { id: 'pantry-1', householdId: 'household-a' },
      })
      expect(prisma.pantryItem.update).toHaveBeenCalledWith({
        where: { id: 'pantry-1' },
        data: { quantity, lowAt: null },
        include: INCLUDE,
      })
      expect(prisma.pantryItem.create).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['have_some', null],
    ['ran_out', 0],
  ])('keeps a staple a staple for %s', async (status, quantity) => {
    const staple = pantryRow({ isStaple: true })
    vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue(staple as never)
    vi.mocked(prisma.pantryItem.findFirst).mockResolvedValue(staple as never)
    vi.mocked(prisma.pantryItem.update).mockImplementation((async ({ data }: never) => ({
      ...staple,
      ...(data as object),
      ingredient: MILK,
    })) as never)

    const result = await call({ ingredientId: 'ing-milk', status })

    expect(result.structuredContent).toMatchObject({ item: { quantity, isStaple: true } })
    expect(vi.mocked(prisma.pantryItem.update).mock.calls[0]![0].data).toEqual({
      quantity,
      lowAt: null,
    })
  })

  it('writes the amount have_some brings, on a new item and on an existing one', async () => {
    vi.mocked(prisma.pantryItem.findUnique).mockResolvedValueOnce(null)

    const created = await call({ ingredientId: 'ing-milk', status: 'have_some', amount: 1800 })

    expect(created.structuredContent).toMatchObject({
      outcome: 'created',
      item: { quantity: 1800, unit: 'ml' },
    })
    expect(prisma.pantryItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quantity: 1800 }) }),
    )

    vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue(
      pantryRow({ quantity: null }) as never,
    )
    vi.mocked(prisma.pantryItem.findFirst).mockResolvedValue(pantryRow({ quantity: null }) as never)

    const updated = await call({ ingredientId: 'ing-milk', status: 'have_some', amount: 1800 })

    expect(updated.structuredContent).toMatchObject({
      outcome: 'updated',
      item: { quantity: 1800 },
    })
    expect(prisma.pantryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pantry-1' },
        data: { quantity: 1800, lowAt: null },
      }),
    )
  })

  it('refuses an amount on a staple and writes nothing', async () => {
    const staple = pantryRow({ isStaple: true, quantity: null })
    vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue(staple as never)
    vi.mocked(prisma.pantryItem.findFirst).mockResolvedValue(staple as never)

    const result = await call({ ingredientId: 'ing-milk', status: 'have_some', amount: 1800 })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('a staple takes no amount'),
    })
    expect(prisma.pantryItem.create).not.toHaveBeenCalled()
    expect(prisma.pantryItem.update).not.toHaveBeenCalled()
  })

  it("refuses another household's ingredient as unknown and writes nothing", async () => {
    // The ingredient lookup is limited to global and the caller's own, so
    // household B's ingredient is not found.
    vi.mocked(prisma.ingredient.findFirst).mockResolvedValue(null)

    const result = await call({ ingredientId: 'ing-household-b', status: 'have_some' })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('no ingredient with this id'),
    })
    expect(prisma.pantryItem.findUnique).not.toHaveBeenCalled()
    expect(prisma.pantryItem.create).not.toHaveBeenCalled()
    expect(prisma.pantryItem.update).not.toHaveBeenCalled()
  })

  it('updates the item a concurrent request created first', async () => {
    vi.mocked(prisma.pantryItem.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(pantryRow() as never)
    vi.mocked(prisma.pantryItem.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )
    vi.mocked(prisma.pantryItem.findFirst).mockResolvedValue(pantryRow() as never)

    const result = await call({ ingredientId: 'ing-milk', status: 'ran_out' })

    expect(result.structuredContent).toMatchObject({ outcome: 'updated', item: { quantity: 0 } })
    expect(prisma.pantryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pantry-1' }, data: { quantity: 0, lowAt: null } }),
    )
  })

  it('answers a retry message when the item disappears between the two reads', async () => {
    vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue(pantryRow() as never)
    vi.mocked(prisma.pantryItem.findFirst).mockResolvedValue(null)

    const result = await call({ ingredientId: 'ing-milk', status: 'have_some' })

    expect(result.isError).toBe(true)
    expect(prisma.pantryItem.update).not.toHaveBeenCalled()
  })

  it('answers a retry message when the item disappears just before the update', async () => {
    vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue(pantryRow() as never)
    vi.mocked(prisma.pantryItem.findFirst).mockResolvedValue(pantryRow() as never)
    vi.mocked(prisma.pantryItem.update).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    )

    const result = await call({ ingredientId: 'ing-milk', status: 'have_some' })

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('pantry changed') })
  })

  it.each([
    ['an amount', { status: 200 }],
    ['0', { status: 0 }],
    ['null', { status: null }],
    ['another string', { status: 'half' }],
    ['the old quantity field', { quantity: 200 }],
    ['an amount with ran_out', { status: 'ran_out', amount: 1800 }],
    ['an amount with running_low', { status: 'running_low', amount: 1800 }],
    ['an amount of 0', { status: 'have_some', amount: 0 }],
    ['a negative amount', { status: 'have_some', amount: -1 }],
    ['an amount as text', { status: 'have_some', amount: '1800' }],
  ])('refuses %s at the schema, so nothing is written', (_label, input) => {
    expect(
      setPantryStatus.inputSchema.safeParse({ ingredientId: 'ing-milk', ...input }).success,
    ).toBe(false)
  })

  it('reports the household-language name for an et household', async () => {
    vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.pantryItem.create).mockResolvedValue({
      ...pantryRow(),
      ingredient: { ...MILK, translations: [{ locale: 'et', name: 'Piim' }] },
    } as never)

    const result = await call(
      { ingredientId: 'ing-milk', status: 'have_some' },
      { ...ctx, household: mcpHousehold({ id: 'household-a', locale: 'et' }) },
    )

    expect(result.structuredContent).toMatchObject({ item: { name: 'Piim' } })
  })

  describe('running_low (HON-1586)', () => {
    it('marks a staple at "have some" low and keeps it a staple at null', async () => {
      const staple = pantryRow({ isStaple: true, quantity: null })
      vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue(staple as never)
      vi.mocked(prisma.pantryItem.findFirst).mockResolvedValue(staple as never)
      vi.mocked(prisma.pantryItem.update).mockImplementation((async ({ data }: never) => ({
        ...staple,
        ...(data as object),
        ingredient: MILK,
      })) as never)

      const result = await call({ ingredientId: 'ing-milk', status: 'running_low' })

      expect(result.structuredContent).toEqual({
        outcome: 'updated',
        item: {
          ingredientId: 'ing-milk',
          name: 'Milk',
          quantity: null,
          unit: 'ml',
          isStaple: true,
          low: true,
        },
      })
      expect(vi.mocked(prisma.pantryItem.update).mock.calls[0]![0].data).toEqual({
        lowAt: expect.any(Date),
      })
    })

    it('marks a non-staple at 0 low and sets it to "have some"', async () => {
      const ranOut = pantryRow({ quantity: 0 })
      vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue(ranOut as never)
      vi.mocked(prisma.pantryItem.findFirst).mockResolvedValue(ranOut as never)

      const result = await call({ ingredientId: 'ing-milk', status: 'running_low' })

      expect(result.structuredContent).toMatchObject({
        outcome: 'updated',
        item: { quantity: null, isStaple: false, low: true },
      })
      expect(vi.mocked(prisma.pantryItem.update).mock.calls[0]![0].data).toEqual({
        lowAt: expect.any(Date),
        quantity: null,
      })
    })

    it('keeps the amount of a counted row it marks low', async () => {
      vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue(pantryRow() as never)
      vi.mocked(prisma.pantryItem.findFirst).mockResolvedValue(pantryRow() as never)

      const result = await call({ ingredientId: 'ing-milk', status: 'running_low' })

      expect(result.structuredContent).toMatchObject({ item: { quantity: 500, low: true } })
    })

    it('puts an ingredient not in the pantry in as "have some" plus low', async () => {
      vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue(null)

      const result = await call({ ingredientId: 'ing-milk', status: 'running_low' })

      expect(result.structuredContent).toMatchObject({
        outcome: 'created',
        item: { quantity: null, low: true },
      })
      expect(prisma.pantryItem.create).toHaveBeenCalledWith({
        data: {
          householdId: 'household-a',
          ingredientId: 'ing-milk',
          quantity: null,
          isStaple: false,
          lowAt: expect.any(Date),
        },
        include: INCLUDE,
      })
    })

    it('clears low with have_some', async () => {
      const low = pantryRow({ quantity: null, lowAt: new Date('2026-10-31') })
      vi.mocked(prisma.pantryItem.findUnique).mockResolvedValue(low as never)
      vi.mocked(prisma.pantryItem.findFirst).mockResolvedValue(low as never)
      vi.mocked(prisma.pantryItem.update).mockImplementation((async ({ data }: never) => ({
        ...low,
        ...(data as object),
        ingredient: MILK,
      })) as never)

      const result = await call({ ingredientId: 'ing-milk', status: 'have_some' })

      expect(result.structuredContent).toMatchObject({ item: { quantity: null, low: false } })
      expect(vi.mocked(prisma.pantryItem.update).mock.calls[0]![0].data).toEqual({
        quantity: null,
        lowAt: null,
      })
    })
  })
})
