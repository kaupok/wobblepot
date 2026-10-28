import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createDayExtra } from '@/lib/day-extras/day-extras'
import { runTool, ToolInputError, WRITE_SCOPE_MESSAGE } from '@/lib/mcp/context'
import { mcpHousehold, READ_SCOPES } from '@/test/mcp'
import { removeExtra } from './remove-extra'

// Runs against PGlite through the `unit-db` project, with no mocks: the
// extras are saved with `createDayExtra` and the rows are read back (HON-1311).

// Thursday 15 October 2026, noon in Tallinn: Saturday is 17 October.
const NOW = new Date('2026-10-15T09:00:00Z')
const SATURDAY = '2026-10-17'
const CALLER = { userId: 'user-1' }
const NOT_FOUND = 'No extra with this id. Use get_meal_plan to find it. Nothing was changed.'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

/** Alder and Birch, in Tallinn, each with a free-text extra on Saturday. */
async function world() {
  const household = async (name: string) => {
    const row = await prisma.household.create({
      data: { name, locale: 'en', timezone: 'Europe/Tallinn' },
    })
    const view = mcpHousehold({ id: row.id, locale: 'en', timezone: 'Europe/Tallinn' })
    const created = await createDayExtra(view, { date: SATURDAY, label: `${name} chips` })
    if (created.status !== 'created') throw new Error('extra not created')
    return { household: view, extraId: created.extra.id }
  }
  return { alder: await household('Alder'), birch: await household('Birch') }
}

function call(household: ReturnType<typeof mcpHousehold>, extraId: string) {
  return removeExtra.run(household, removeExtra.inputSchema.parse({ extraId }), CALLER)
}

describe('remove_extra', () => {
  it("deletes the household's extra and takes its unticked shopping item off the list", async () => {
    const { alder } = await world()

    const result = await call(alder.household, alder.extraId)

    expect(result).toEqual({ outcome: 'removed', extraId: alder.extraId })
    expect(await prisma.dayExtra.findUnique({ where: { id: alder.extraId } })).toBeNull()
    const custom = await prisma.customShoppingItem.findMany({ select: { name: true } })
    expect(custom).toEqual([{ name: 'Birch chips' }])
  })

  it("refuses another household's extra, and that extra stays", async () => {
    const { alder, birch } = await world()

    const attempt = call(alder.household, birch.extraId)

    await expect(attempt).rejects.toThrow(ToolInputError)
    await expect(attempt).rejects.toThrow(NOT_FOUND)
    expect(await prisma.dayExtra.findUnique({ where: { id: birch.extraId } })).not.toBeNull()
  })

  it('refuses an unknown id', async () => {
    const { alder } = await world()

    await expect(call(alder.household, 'extra-gone')).rejects.toThrow(NOT_FOUND)
    expect(await prisma.dayExtra.count()).toBe(2)
  })

  it('answers a read-only token with the reconnect message, and the extra stays', async () => {
    const { alder } = await world()

    const result = await runTool(
      removeExtra,
      { userId: 'user-1', household: alder.household, scopes: READ_SCOPES },
      { extraId: alder.extraId },
    )

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: WRITE_SCOPE_MESSAGE }],
    })
    expect(await prisma.dayExtra.findUnique({ where: { id: alder.extraId } })).not.toBeNull()
  })
})
