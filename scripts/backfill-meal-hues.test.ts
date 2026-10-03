import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { HueResult } from '../src/lib/meal-images/colour'
import {
  formatBaseline,
  hueHistogram,
  meanShares,
  parseArgs,
  rehue,
  renderHistogram,
  run,
  type Db,
  type RehueMeal,
  type RunDeps,
} from './backfill-meal-hues'

const UPDATED = new Date('2026-09-01T00:00:00Z')

const meal = (id: string, imageHue: number | null, imageUrl = `https://blob/${id}.png`) =>
  ({ id, name: `Meal ${id}`, imageUrl, imageHue, updatedAt: UPDATED }) satisfies RehueMeal

const result = (hue: number | null, bins = new Array(18).fill(0)): HueResult => ({
  hue,
  chroma: 0.1,
  coverage: 0.5,
  opaque: 1,
  bins,
})

function deps(meals: RehueMeal[], hues: Record<string, HueResult>, overrides = {}) {
  const updateMany = vi.fn(async () => ({ count: 1 }))
  const db = { meal: { findMany: vi.fn(async () => meals), updateMany } } as unknown as Db
  const lines: string[] = []
  const d: RunDeps = {
    db,
    fetchImage: vi.fn(async (url: string) => {
      if (!(url in hues)) throw new Error('HTTP 404')
      return new TextEncoder().encode(url)
    }),
    extract: async (bytes) => hues[new TextDecoder().decode(bytes)] as HueResult,
    ask: vi.fn(async () => 'db.example'),
    env: { DATABASE_URL: 'postgresql://u:p@db.example/neondb' },
    now: () => new Date('2026-10-03T09:00:00Z'),
    outRoot: mkdtempSync(join(tmpdir(), 'rehue-')),
    log: (line) => lines.push(line),
    ...overrides,
  }
  return { d, updateMany, lines }
}

describe('HON-1009: meal hue backfill', () => {
  it('parses args and rejects clashes', () => {
    expect(parseArgs([])).toEqual({ help: false, baseline: false, confirm: false, yes: undefined })
    expect(parseArgs(['--confirm', '--yes=db.example'])).toMatchObject({
      confirm: true,
      yes: 'db.example',
    })
    expect(() => parseArgs(['--baseline', '--confirm'])).toThrow('cannot be combined')
    expect(() => parseArgs(['--yes=x'])).toThrow('only applies to --confirm')
    expect(() => parseArgs(['--confirm', '--yes'])).toThrow('needs a value')
    expect(() => parseArgs(['--nope'])).toThrow('Unknown argument')
  })

  it('buckets hues by 20° and counts meals with no hue', () => {
    const { buckets, none } = hueHistogram([0, 19, 20, 359, null])
    expect(buckets[0]).toBe(2)
    expect(buckets[1]).toBe(1)
    expect(buckets[17]).toBe(1)
    expect(none).toBe(1)
    expect(renderHistogram([50], [130]).split('\n')).toContain(
      `${'120–139'.padEnd(8)}   0 ${''.padEnd(3)}    1 #`,
    )
  })

  it('averages shares per image and leaves out images with no chroma', () => {
    expect(
      meanShares(
        [
          [3, 1],
          [0, 2],
          [0, 0],
        ],
        2,
      ),
    ).toEqual([0.375, 0.625])
    expect(formatBaseline([0.12345, 0.5], { date: '2026-10-03', count: 7 })).toContain(
      'from 7 images.\nexport const HUE_BASELINE: readonly number[] = [\n  0.1235, 0.5000,\n]',
    )
  })

  it('fetches a shared image once and skips the meals on an unreadable one', async () => {
    const shared = 'https://blob/shared.png'
    const meals = [meal('a', 50, shared), meal('b', 50, shared), meal('c', 40)]
    const { d, lines } = deps(meals, { [shared]: result(120) })
    const rows = await rehue(meals, d)
    expect(d.fetchImage).toHaveBeenCalledTimes(2)
    expect(rows.map((r) => r.result?.hue ?? null)).toEqual([120, 120, null])
    expect(lines.join('\n')).toContain('Meal c: skipped')
  })

  it('writes the contact sheet and nothing to the database on a dry run', async () => {
    const meals = [meal('a', 50), meal('b', 70)]
    const { d, updateMany, lines } = deps(meals, {
      'https://blob/a.png': result(120),
      'https://blob/b.png': result(70),
    })
    await run(parseArgs([]), d)
    expect(updateMany).not.toHaveBeenCalled()
    const [dir] = readdirSync(d.outRoot)
    const html = readFileSync(join(d.outRoot, dir ?? '', 'index.html'), 'utf8')
    expect(html).toContain('old 50°')
    expect(html).toContain('new 120°')
    expect(html).toContain('1 change hue')
    expect(lines.join('\n')).toContain('1 of 2 hue(s) change')
  })

  it('prints the baseline from distinct images and writes nothing', async () => {
    const shared = 'https://blob/shared.png'
    const bins = [1, 3, ...new Array(16).fill(0)]
    const meals = [meal('a', 50, shared), meal('b', 50, shared)]
    const { d, updateMany, lines } = deps(meals, { [shared]: result(30, bins) })
    await run(parseArgs(['--baseline']), d)
    expect(updateMany).not.toHaveBeenCalled()
    expect(existsSync(d.outRoot) && readdirSync(d.outRoot)).toEqual([])
    expect(lines.join('\n')).toContain('from 1 images.')
    expect(lines.join('\n')).toContain('0.2500, 0.7500')
  })

  it('writes only imageHue, pinned to the image and updatedAt, for changed hues', async () => {
    const meals = [meal('a', 50), meal('b', 70)]
    const { d, updateMany } = deps(meals, {
      'https://blob/a.png': result(120),
      'https://blob/b.png': result(70),
    })
    expect(await run(parseArgs(['--confirm', '--yes=db.example']), d)).toEqual({
      written: 1,
      stale: 0,
    })
    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'a', imageUrl: 'https://blob/a.png', updatedAt: UPDATED },
      data: { imageHue: 120, updatedAt: UPDATED },
    })
  })

  it('counts a meal that changed during the run as stale', async () => {
    const { d, updateMany, lines } = deps([meal('a', 50)], { 'https://blob/a.png': result(120) })
    updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await run(parseArgs(['--confirm', '--yes=db.example']), d)).toEqual({
      written: 0,
      stale: 1,
    })
    expect(lines.join('\n')).toContain('changed since it was read')
  })

  it('refuses to write when the host is not typed back', async () => {
    const { d, updateMany } = deps([meal('a', 50)], { 'https://blob/a.png': result(120) })
    await expect(run(parseArgs(['--confirm', '--yes=other.host']), d)).rejects.toThrow(
      'Host not confirmed',
    )
    expect(updateMany).not.toHaveBeenCalled()
  })
})
