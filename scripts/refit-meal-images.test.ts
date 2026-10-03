import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { FittedImage } from '../src/lib/meal-images/footprint'
import type { Vessel } from '../src/lib/meal-images/vessel'
import {
  fileNameFor,
  mediaTypeOf,
  parseArgs,
  refit,
  renderSummary,
  run,
  type Db,
  type RefitMeal,
  type RunDeps,
} from './refit-meal-images'

const UPDATED = new Date('2026-09-01T00:00:00Z')

const meal = (
  id: string,
  imageUrl: string | null = `https://blob/${id}.png`,
  name = `Meal ${id}`,
) => ({ id, name, imageUrl, updatedAt: UPDATED }) satisfies RefitMeal

/** What the stub fit does to each URL: scale by this factor, or leave it (1). */
type Plan = Record<string, { vessel: Vessel; scale: number; measured?: number }>

function deps(meals: RefitMeal[], plan: Plan, overrides: Partial<RunDeps> = {}) {
  const updateMany = vi.fn(async () => ({ count: 1 }))
  const db = { meal: { findMany: vi.fn(async () => meals), updateMany } } as unknown as Db
  const lines: string[] = []
  const put = vi.fn(async (mealId: string) => `https://blob/${mealId}-fitted.png`)
  const remove = vi.fn(async () => {})
  const d: RunDeps = {
    db,
    fetchImage: vi.fn(async (url: string) => {
      if (!(url in plan)) throw new Error('HTTP 404')
      return new TextEncoder().encode(url)
    }),
    classify: vi.fn(async ({ bytes }) => plan[new TextDecoder().decode(bytes)]?.vessel ?? null),
    fit: vi.fn(async (bytes, mediaType, vessel): Promise<FittedImage> => {
      const { scale, measured = 0.64 } = plan[new TextDecoder().decode(bytes)]!
      const target = vessel === 'plate' ? 0.58 : vessel === 'bowl' ? 0.42 : null
      return scale === 1
        ? {
            bytes,
            mediaType,
            fit: {
              vessel,
              measuredWidth: measured,
              targetWidth: target,
              elevationDeg: vessel === 'plate' ? 40 : null,
              scale: 1,
              action: 'keep',
              reason: 'already at the target width',
            },
          }
        : {
            bytes: new Uint8Array([...bytes, 0]),
            mediaType: 'image/png',
            fit: {
              vessel,
              measuredWidth: measured,
              targetWidth: target,
              elevationDeg: vessel === 'plate' ? 40 : null,
              scale,
              action: 'fit',
            },
          }
    }),
    put,
    remove,
    ask: vi.fn(async () => 'db.example'),
    env: { DATABASE_URL: 'postgresql://u:p@db.example/neondb', BLOB_READ_WRITE_TOKEN: 'rw' },
    now: () => new Date('2026-10-03T09:00:00Z'),
    outRoot: mkdtempSync(join(tmpdir(), 'refit-')),
    log: (line) => lines.push(line),
    ...overrides,
  }
  return { d, updateMany, put, remove, lines }
}

describe('HON-1024: meal footprint backfill', () => {
  it('parses args and rejects clashes', () => {
    expect(parseArgs([])).toEqual({ help: false, confirm: false, yes: undefined })
    expect(parseArgs(['--confirm', '--yes=db.example'])).toMatchObject({
      confirm: true,
      yes: 'db.example',
    })
    expect(() => parseArgs(['--yes=db.example'])).toThrow('--yes only applies to --confirm')
    expect(() => parseArgs(['--yes'])).toThrow('--yes needs a value')
    expect(() => parseArgs(['--limit=3'])).toThrow('Unknown argument: --limit=3')
  })

  it('reads the media type from the stored URL, PNG by default', () => {
    expect(mediaTypeOf('https://blob/meals/a-x1.png')).toBe('image/png')
    expect(mediaTypeOf('https://blob/meals/a-x1.jpg?download=1')).toBe('image/jpeg')
    expect(mediaTypeOf('https://blob/meals/a-x1.webp')).toBe('image/webp')
    expect(mediaTypeOf('https://blob/meals/a-x1')).toBe('image/png')
  })

  it('fits a shared image once, and leaves an unreadable or unclassified one as it is', async () => {
    const shared = 'https://blob/shared.png'
    const meals = [meal('a', shared), meal('b', shared), meal('c'), meal('d')]
    const { d, lines } = deps(meals, {
      [shared]: { vessel: 'plate', scale: 0.9 },
      'https://blob/d.png': { vessel: null as unknown as Vessel, scale: 1 },
    })

    const images = await refit(meals, d)

    expect(d.fetchImage).toHaveBeenCalledTimes(3)
    expect(images.map((i) => [i.url, i.meals.length, i.vessel, i.fitted?.fit.action])).toEqual([
      [shared, 2, 'plate', 'fit'],
      ['https://blob/c.png', 1, null, undefined],
      ['https://blob/d.png', 1, null, undefined],
    ])
    expect(lines.join('\n')).toContain('Meal c: skipped, could not read')
    expect(lines.join('\n')).toContain('Meal d: left as drawn, the vessel could not be classified')
  })

  it('summarises per vessel: count, width range, target and how many move', async () => {
    const meals = [meal('a'), meal('b'), meal('c')]
    const images = await refit(
      meals,
      deps(meals, {
        'https://blob/a.png': { vessel: 'plate', scale: 0.9, measured: 0.64 },
        'https://blob/b.png': { vessel: 'plate', scale: 1, measured: 0.58 },
        'https://blob/c.png': { vessel: 'glass', scale: 1, measured: 0.3 },
      }).d,
    )
    const summary = renderSummary(images)
    expect(summary).toContain(
      'plate    2 image(s), width 0.58–0.64 as drawn, camera 40–40°, target 0.58, 1 to refit',
    )
    expect(summary).toContain('glass    1 image(s), width 0.30–0.30 as drawn, left as drawn')
  })

  it('writes the sheet and the fitted files, and nothing to the database or Blob, on a dry run', async () => {
    const meals = [meal('a', undefined, 'Eggs Benedict'), meal('b')]
    const { d, updateMany, put, lines } = deps(meals, {
      'https://blob/a.png': { vessel: 'plate', scale: 0.92 },
      'https://blob/b.png': { vessel: 'bowl', scale: 1 },
    })

    await run(parseArgs([]), d)

    expect(updateMany).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    const [dir] = readdirSync(d.outRoot)
    const files = readdirSync(join(d.outRoot, dir ?? ''))
    expect(files.sort()).toEqual(['eggs-benedict-a.png', 'index.html'])
    const html = readFileSync(join(d.outRoot, dir ?? '', 'index.html'), 'utf8')
    expect(html).toContain('fitted ×0.92 → 0.58')
    expect(html).toContain('src="eggs-benedict-a.png"')
    expect(html).toContain('unchanged: already at the target width')
    expect(html).toContain('--t:58.0%')
    expect(lines.join('\n')).toContain('1 of 2 stored image(s) refit.')
    expect(lines.join('\n')).toContain('Dry run')
  })

  it('uploads once per image, moves every meal on it with updatedAt pinned, and deletes the old blob', async () => {
    const shared = 'https://blob/shared.png'
    const meals = [meal('a', shared), meal('b', shared), meal('c')]
    const { d, updateMany, put, remove } = deps(meals, {
      [shared]: { vessel: 'plate', scale: 0.9 },
      'https://blob/c.png': { vessel: 'plate', scale: 1 },
    })

    expect(await run(parseArgs(['--confirm', '--yes=db.example']), d)).toEqual({
      moved: 2,
      stale: 0,
    })

    expect(put).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledWith('a', expect.any(Buffer), 'image/png')
    expect(updateMany).toHaveBeenCalledTimes(2)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'b', imageUrl: shared, updatedAt: UPDATED },
      data: { imageUrl: 'https://blob/a-fitted.png', updatedAt: UPDATED },
    })
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(shared)
    expect(existsSync(d.outRoot) && readdirSync(d.outRoot)).toEqual([])
  })

  it('keeps the old blob while a stale meal still points at it', async () => {
    const shared = 'https://blob/shared.png'
    const meals = [meal('a', shared), meal('b', shared)]
    const { d, updateMany, remove, lines } = deps(meals, {
      [shared]: { vessel: 'bowl', scale: 1.1 },
    })
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })

    expect(await run(parseArgs(['--confirm', '--yes=db.example']), d)).toEqual({
      moved: 1,
      stale: 1,
    })
    expect(remove).not.toHaveBeenCalled()
    expect(lines.join('\n')).toContain('Meal b: changed since it was read')
    expect(lines.join('\n')).toContain('old image kept, 1 meal(s) still point at it')
  })

  it('deletes its own upload when no meal moved', async () => {
    const { d, updateMany, remove } = deps([meal('a')], {
      'https://blob/a.png': { vessel: 'plate', scale: 0.9 },
    })
    updateMany.mockResolvedValue({ count: 0 })

    expect(await run(parseArgs(['--confirm', '--yes=db.example']), d)).toEqual({
      moved: 0,
      stale: 1,
    })
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('https://blob/a-fitted.png')
  })

  it('refuses to write when the host is not typed back, and checks Blob first', async () => {
    const { d, put } = deps([meal('a')], { 'https://blob/a.png': { vessel: 'plate', scale: 0.9 } })
    await expect(run(parseArgs(['--confirm', '--yes=other.host']), d)).rejects.toThrow(
      'Host not confirmed',
    )
    expect(put).not.toHaveBeenCalled()

    const noBlob = deps(
      [meal('a')],
      { 'https://blob/a.png': { vessel: 'plate', scale: 0.9 } },
      {
        env: { DATABASE_URL: 'postgresql://u:p@db.example/neondb' },
      },
    )
    await expect(run(parseArgs(['--confirm', '--yes=db.example']), noBlob.d)).rejects.toThrow(
      'Blob needs',
    )
  })

  it('names the fitted file after the first meal and its id, so two same-named meals never collide', () => {
    expect(
      fileNameFor({
        url: 'u',
        meals: [meal('a', 'u', 'Eggs Benedict (brunch)')],
        vessel: 'plate',
        fitted: null,
      }),
    ).toBe('eggs-benedict-brunch-a.png')
  })
})
