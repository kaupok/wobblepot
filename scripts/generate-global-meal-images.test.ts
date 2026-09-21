import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JudgeVerdict } from '../src/lib/meal-images/judge'
import { buildMealImagePrompt, MEAL_IMAGE_PROMPT_VERSION } from '../src/lib/meal-images/prompt'
import {
  buildPublishPlan,
  checkBlobCredentials,
  confirmHost,
  databaseHost,
  estimateUsd,
  IMAGE_EST_USD,
  JUDGE_EST_USD,
  parseArgs,
  parseExclude,
  readManifest,
  run,
  runPublish,
  selectionWhere,
  selectMeals,
  toJobResult,
  toMealImageMeal,
  uniqueBySlug,
  type Db,
  type GlobalMeal,
  type Manifest,
  type ManifestEntry,
  type RunDeps,
} from './generate-global-meal-images'

// Never spend or write: the generator, Blob and Prisma are all mocks.

const UPDATED_AT = new Date('2026-09-01T00:00:00Z')
const NOW = new Date('2026-09-22T12:00:00Z')

function meal(name: string, overrides: Partial<GlobalMeal> = {}): GlobalMeal {
  return {
    id: `id-${name.toLowerCase().replace(/\W+/g, '-')}`,
    name,
    description: `${name}, home-cooked`,
    preparationNotes: null,
    updatedAt: UPDATED_AT,
    imageUrl: null,
    imageStatus: 'none',
    imagePromptVersion: null,
    components: [
      {
        quantityPerServing: 150,
        ingredient: { name: 'potato', defaultUnit: 'g', gramsPerPiece: null, densityGPerMl: null },
      },
    ],
    ...overrides,
  }
}

function mockDb(opts: { findMany?: GlobalMeal[]; updateCount?: number } = {}) {
  const findMany = vi.fn().mockResolvedValue(opts.findMany ?? [])
  const updateMany = vi.fn().mockResolvedValue({ count: opts.updateCount ?? 1 })
  return { db: { meal: { findMany, updateMany } } as unknown as Db, findMany, updateMany }
}

const verdict: JudgeVerdict = {
  raw: {
    extraIngredients: ['olives'],
    propsOrCookware: [],
    missingIngredients: [],
    portion: 'one-serving',
  },
  filtered: {
    extraIngredients: ['olives'],
    propsOrCookware: [],
    missingIngredients: [],
    portion: 'one-serving',
  },
  pass: false,
  strictPass: false,
}

function entryFor(m: GlobalMeal, overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  const slug = m.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return {
    slug,
    name: m.name,
    sourceMealId: m.id,
    prompt: buildMealImagePrompt(toMealImageMeal(m)),
    file: `${slug}.png`,
    mediaType: 'image/png',
    usd: 0.0422,
    latencyMs: 18_000,
    ...overrides,
  }
}

const manifestOf = (entries: ManifestEntry[]): Manifest => ({
  startedAt: '2026-09-22T10:00:00.000Z',
  promptVersion: MEAL_IMAGE_PROMPT_VERSION,
  judge: false,
  entries,
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'global-meal-images-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function deps(overrides: Partial<RunDeps> & { db: Db }): RunDeps & { lines: string[] } {
  const lines: string[] = []
  return {
    generate: vi.fn(),
    put: vi.fn(),
    remove: vi.fn(),
    ask: vi.fn(),
    env: {},
    now: () => NOW,
    outRoot: dir,
    log: (line) => lines.push(line),
    lines,
    ...overrides,
  }
}

describe('parseArgs', () => {
  it('defaults to a dry run', () => {
    expect(parseArgs([])).toEqual({ confirm: false, judge: false, concurrency: 4, exclude: [] })
  })

  it('reads the generate flags', () => {
    expect(
      parseArgs(['--confirm', '--judge', '--limit=3', '--meal=Irish Lamb Stew']),
    ).toMatchObject({
      confirm: true,
      judge: true,
      limit: 3,
      meal: 'Irish Lamb Stew',
    })
  })

  it('reads the publish flags', () => {
    expect(parseArgs(['--publish=.temp/run', '--exclude=a,b', '--yes=db.example'])).toMatchObject({
      publish: '.temp/run',
      exclude: ['a', 'b'],
      yes: 'db.example',
    })
  })

  it.each([
    [['--limit=0']],
    [['--limit=abc']],
    [['--publish']],
    [['--publish=']],
    [['--publish=x', '--confirm']],
    [['--publish=x', '--limit=3']],
    [['--exclude=a']],
    [['--yes=host']],
    [['--bogus']],
  ])('rejects %j', (argv) => {
    expect(() => parseArgs(argv)).toThrow()
  })
})

describe('parseExclude', () => {
  it('trims, lower-cases, de-duplicates and drops empty items', () => {
    expect(parseExclude(' Greek-Salad ,lamb-stew,,greek-salad, ')).toEqual([
      'greek-salad',
      'lamb-stew',
    ])
  })

  it('is empty when absent', () => {
    expect(parseExclude(undefined)).toEqual([])
    expect(parseExclude('')).toEqual([])
  })
})

describe('selection', () => {
  it('selects global, live meals not ready at the current prompt version', () => {
    expect(selectionWhere()).toEqual({
      householdId: null,
      deletedAt: null,
      AND: [
        {
          OR: [
            { imageStatus: { not: 'ready' } },
            { imagePromptVersion: null },
            { imagePromptVersion: { not: MEAL_IMAGE_PROMPT_VERSION } },
          ],
        },
      ],
    })
  })

  it('narrows to one meal by id or English name', () => {
    expect(selectionWhere('Irish Lamb Stew').AND).toContainEqual({
      OR: [{ id: 'Irish Lamb Stew' }, { name: { equals: 'Irish Lamb Stew', mode: 'insensitive' } }],
    })
  })

  it('passes --limit through as take', async () => {
    const { db, findMany } = mockDb()
    await selectMeals(db, { limit: 3 })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, orderBy: { name: 'asc' } }),
    )
  })

  it('drops meals whose names share a slug', () => {
    const { unique, ambiguous } = uniqueBySlug([meal('Pad Thai'), meal('Pad thai!'), meal('Ramen')])
    expect(unique.map((m) => m.name)).toEqual(['Ramen'])
    expect(ambiguous).toEqual(['pad-thai'])
  })

  it('builds the prompt from the English name and description', () => {
    expect(toMealImageMeal(meal('Irish Lamb Stew'))).toEqual({
      name: 'Irish Lamb Stew',
      description: 'Irish Lamb Stew, home-cooked',
      preparationNotes: null,
      components: [
        { name: 'potato', quantity: 150, unit: 'g', gramsPerPiece: null, densityGPerMl: null },
      ],
    })
  })

  it('estimates the image price, plus the judge when asked', () => {
    expect(estimateUsd(10, false)).toBeCloseTo(10 * IMAGE_EST_USD)
    expect(estimateUsd(10, true)).toBeCloseTo(10 * (IMAGE_EST_USD + JUDGE_EST_USD))
  })
})

describe('dry run', () => {
  it('prints the count and cost and touches neither the database nor Blob', async () => {
    const { db, updateMany } = mockDb({ findMany: [meal('Ramen'), meal('Pad Thai')] })
    const d = deps({ db })

    await run(parseArgs([]), d)

    expect(d.lines[0]).toContain('2 global meal(s) need an image')
    expect(d.lines[0]).toContain(`$${(2 * IMAGE_EST_USD).toFixed(2)}`)
    expect(d.lines.at(-1)).toMatch(/^Dry run/)
    expect(updateMany).not.toHaveBeenCalled()
    expect(d.generate).not.toHaveBeenCalled()
    expect(d.put).not.toHaveBeenCalled()
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false)
  })
})

describe('--confirm', () => {
  it('--limit=3 generates 3 images and a contact sheet, and writes nothing to the database or Blob', async () => {
    const meals = [meal('Irish Lamb Stew'), meal('Pad Thai'), meal('Ramen')]
    const { db, findMany, updateMany } = mockDb({ findMany: meals })
    const generate = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
      attempts: 1,
      totalUsd: 0.05,
      verdict,
    })
    const d = deps({
      db,
      generate,
      env: { OPENAI_API_KEY: 'sk-test', ANTHROPIC_API_KEY: 'sk-ant' },
    })

    await run(parseArgs(['--confirm', '--limit=3', '--judge']), d)

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }))
    expect(generate).toHaveBeenCalledTimes(3)
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Irish Lamb Stew' }),
      expect.objectContaining({ judge: 'report', mealId: 'id-irish-lamb-stew' }),
    )
    expect(updateMany).not.toHaveBeenCalled()
    expect(d.put).not.toHaveBeenCalled()

    const runDir = join(dir, NOW.toISOString().replace(/[:.]/g, '-'))
    for (const slug of ['irish-lamb-stew', 'pad-thai', 'ramen']) {
      expect(readFileSync(join(runDir, `${slug}.png`))).toEqual(Buffer.from([1, 2, 3]))
    }
    const manifest = readManifest(runDir)
    expect(manifest.entries.map((e) => e.slug)).toEqual(['irish-lamb-stew', 'pad-thai', 'ramen'])
    expect(manifest.entries[0]).toMatchObject({ verdict, usd: 0.05, mediaType: 'image/png' })
    const sheet = readFileSync(join(runDir, 'index.html'), 'utf8')
    expect(sheet).toContain('Global meal illustrations (HON-738)')
    expect(sheet).toContain('src="ramen.png"')
    // The judge's finding is shown in the cell.
    expect(sheet).toContain('<li>olives</li>')
    expect(d.lines.join('\n')).toContain('Spent $0.15 (not ledgered)')
  })

  it('does not judge without --judge', async () => {
    const { db } = mockDb({ findMany: [meal('Ramen')] })
    const generate = vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1]),
      mediaType: 'image/png',
      attempts: 1,
      totalUsd: 0.04,
      verdict: null,
    })
    await run(parseArgs(['--confirm']), deps({ db, generate, env: { OPENAI_API_KEY: 'sk-test' } }))
    expect(generate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ judge: 'off' }),
    )
  })

  it('records a failed meal and carries on', async () => {
    const { db } = mockDb({ findMany: [meal('Pad Thai'), meal('Ramen')] })
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error('content policy'))
      .mockResolvedValueOnce({
        bytes: new Uint8Array([1]),
        mediaType: 'image/png',
        attempts: 1,
        totalUsd: 0.04,
        verdict: null,
      })
    const d = deps({ db, generate, env: { OPENAI_API_KEY: 'sk-test' } })

    await run(parseArgs(['--confirm', '--concurrency=1']), d)

    const manifest = readManifest(join(dir, NOW.toISOString().replace(/[:.]/g, '-')))
    expect(manifest.entries).toMatchObject([
      { slug: 'pad-thai', error: 'content policy' },
      { slug: 'ramen', file: 'ramen.png' },
    ])
  })

  it('refuses to spend without an OpenAI key', async () => {
    const { db } = mockDb({ findMany: [meal('Ramen')] })
    const d = deps({ db })
    await expect(run(parseArgs(['--confirm']), d)).rejects.toThrow(/OPENAI_API_KEY/)
    expect(d.generate).not.toHaveBeenCalled()
  })
})

describe('toJobResult', () => {
  it('maps a manifest entry to a V3 flare contact-sheet row with filtered findings', () => {
    const m = meal('Ramen')
    expect(toJobResult(entryFor(m, { verdict }))).toMatchObject({
      modelKey: 'flare',
      styleId: 'illustration',
      version: 'v3',
      mealSlug: 'ramen',
      file: 'ramen.png',
      judgeV2: { extraIngredients: ['olives'], pass: false },
    })
    expect(toJobResult(entryFor(m)).judgeV2).toBeUndefined()
  })
})

describe('buildPublishPlan', () => {
  const stew = meal('Irish Lamb Stew')
  const ramen = meal('Ramen')

  it('publishes every entry that is not excluded, failed, ready, missing or changed', () => {
    const ready = meal('Pad Thai', {
      imageStatus: 'ready',
      imagePromptVersion: MEAL_IMAGE_PROMPT_VERSION,
    })
    const changed = meal('Tacos')
    const plan = buildPublishPlan(
      manifestOf([
        entryFor(stew),
        entryFor(ramen),
        entryFor(ready),
        entryFor(changed, { prompt: 'an older prompt' }),
        entryFor(meal('Gyoza')),
        entryFor(meal('Bagel'), { error: 'boom', file: undefined }),
      ]),
      [stew, ramen, ready, changed],
      ['ramen', 'typo-slug'],
    )

    expect(plan.items).toEqual([
      expect.objectContaining({ action: 'publish', meal: stew }),
      { action: 'skip', slug: 'ramen', reason: 'excluded by the operator' },
      { action: 'skip', slug: 'pad-thai', reason: `already ready at ${MEAL_IMAGE_PROMPT_VERSION}` },
      {
        action: 'skip',
        slug: 'tacos',
        reason: 'the meal changed since it was drawn — regenerate it',
      },
      {
        action: 'skip',
        slug: 'gyoza',
        reason: 'no global meal with this name in the target database',
      },
      { action: 'skip', slug: 'bagel', reason: 'generation failed' },
    ])
    expect(plan.unknownExcludes).toEqual(['typo-slug'])
  })

  it('republishes a meal that is ready at an older prompt version', () => {
    const old = meal('Ramen', {
      imageStatus: 'ready',
      imagePromptVersion: 'v2',
      imageUrl: 'https://blob/old.png',
    })
    const plan = buildPublishPlan(manifestOf([entryFor(old)]), [old], [])
    expect(plan.items[0]).toMatchObject({ action: 'publish' })
  })

  it('matches by name, not by id, so one run publishes to any database', () => {
    const elsewhere = { ...stew, id: 'a-different-cuid' }
    const plan = buildPublishPlan(manifestOf([entryFor(stew)]), [elsewhere], [])
    expect(plan.items[0]).toMatchObject({ action: 'publish', meal: { id: 'a-different-cuid' } })
  })

  it('skips a slug shared by two meals in the target', () => {
    const plan = buildPublishPlan(manifestOf([entryFor(ramen)]), [ramen, { ...ramen, id: 'x' }], [])
    expect(plan.items[0]).toMatchObject({
      action: 'skip',
      reason: '2 global meals share this name',
    })
  })

  it('refuses a run drawn with another prompt version', () => {
    expect(() => buildPublishPlan({ ...manifestOf([]), promptVersion: 'v2' }, [], [])).toThrow(/v2/)
  })
})

describe('runPublish', () => {
  function writeImages(...slugs: string[]) {
    for (const slug of slugs) writeFileSync(join(dir, `${slug}.png`), Buffer.from([9]))
  }

  const publishDeps = (db: Db, put = vi.fn().mockResolvedValue('https://blob/new.png')) => ({
    db,
    put,
    remove: vi.fn().mockResolvedValue(undefined),
    readFile: (path: string) => readFileSync(path),
    now: () => NOW,
    log: () => {},
  })

  it('claims, uploads, and sets the three columns', async () => {
    const stew = meal('Irish Lamb Stew')
    writeImages('irish-lamb-stew')
    const { db, updateMany } = mockDb()
    const d = publishDeps(db)

    const result = await runPublish(
      buildPublishPlan(manifestOf([entryFor(stew)]), [stew], []),
      dir,
      d,
    )

    expect(result.published).toEqual(['irish-lamb-stew'])
    expect(d.put).toHaveBeenCalledWith(stew.id, Buffer.from([9]), 'image/png')
    // Claim: only while the meal still needs an image and no live claim holds it.
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({ id: stew.id, householdId: null, updatedAt: UPDATED_AT }),
      data: { imageClaimedAt: NOW, updatedAt: UPDATED_AT },
    })
    // Attach: only under this claim.
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: stew.id, imageClaimedAt: NOW, updatedAt: UPDATED_AT },
      data: {
        imageStatus: 'ready',
        imageUrl: 'https://blob/new.png',
        imagePromptVersion: MEAL_IMAGE_PROMPT_VERSION,
        imageClaimedAt: null,
        imageAttempts: 0,
        updatedAt: UPDATED_AT,
      },
    })
    expect(d.remove).not.toHaveBeenCalled()
  })

  it('is idempotent: a second run over the published state uploads nothing', async () => {
    const stew = meal('Irish Lamb Stew')
    writeImages('irish-lamb-stew')
    const manifest = manifestOf([entryFor(stew)])
    const { db, updateMany } = mockDb()
    const d = publishDeps(db)
    await runPublish(buildPublishPlan(manifest, [stew], []), dir, d)

    const published = {
      ...stew,
      imageStatus: 'ready' as const,
      imageUrl: 'https://blob/new.png',
      imagePromptVersion: MEAL_IMAGE_PROMPT_VERSION,
    }
    updateMany.mockClear()
    d.put.mockClear()
    const second = await runPublish(buildPublishPlan(manifest, [published], []), dir, d)

    expect(second.published).toEqual([])
    expect(second.skipped).toEqual([
      { slug: 'irish-lamb-stew', reason: `already ready at ${MEAL_IMAGE_PROMPT_VERSION}` },
    ])
    expect(d.put).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('skips a meal whose claim is lost, without uploading', async () => {
    const stew = meal('Irish Lamb Stew')
    writeImages('irish-lamb-stew')
    const { db } = mockDb({ updateCount: 0 })
    const d = publishDeps(db)

    const result = await runPublish(
      buildPublishPlan(manifestOf([entryFor(stew)]), [stew], []),
      dir,
      d,
    )

    expect(result.skipped[0]?.reason).toMatch(/claimed/)
    expect(d.put).not.toHaveBeenCalled()
  })

  it('deletes the upload when the meal is edited mid-publish', async () => {
    const stew = meal('Irish Lamb Stew')
    writeImages('irish-lamb-stew')
    const { db, updateMany } = mockDb()
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    const d = publishDeps(db)

    const result = await runPublish(
      buildPublishPlan(manifestOf([entryFor(stew)]), [stew], []),
      dir,
      d,
    )

    expect(result.published).toEqual([])
    expect(d.remove).toHaveBeenCalledWith('https://blob/new.png')
  })

  it('deletes the replaced image of an older prompt version', async () => {
    const old = meal('Ramen', {
      imageStatus: 'ready',
      imagePromptVersion: 'v2',
      imageUrl: 'https://blob/old.png',
    })
    writeImages('ramen')
    const { db } = mockDb()
    const d = publishDeps(db)

    await runPublish(buildPublishPlan(manifestOf([entryFor(old)]), [old], []), dir, d)

    expect(d.remove).toHaveBeenCalledWith('https://blob/old.png')
  })

  it('releases the claim when the upload fails, and carries on', async () => {
    const stew = meal('Irish Lamb Stew')
    const ramen = meal('Ramen')
    writeImages('irish-lamb-stew', 'ramen')
    const { db, updateMany } = mockDb()
    const put = vi
      .fn()
      .mockRejectedValueOnce(new Error('403'))
      .mockResolvedValueOnce('https://blob/r.png')
    const d = publishDeps(db, put)

    const result = await runPublish(
      buildPublishPlan(manifestOf([entryFor(stew), entryFor(ramen)]), [stew, ramen], []),
      dir,
      d,
    )

    expect(result.failed).toEqual([{ slug: 'irish-lamb-stew', error: '403' }])
    expect(result.published).toEqual(['ramen'])
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: stew.id, imageClaimedAt: NOW, updatedAt: UPDATED_AT },
      data: { imageClaimedAt: null, updatedAt: UPDATED_AT },
    })
  })
})

describe('--publish', () => {
  const stew = meal('Irish Lamb Stew')
  const env = {
    DATABASE_URL: 'postgresql://u:p@ep-staging.neon.tech/db',
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x',
  }

  function writeRun() {
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifestOf([entryFor(stew)])))
    writeFileSync(join(dir, 'irish-lamb-stew.png'), Buffer.from([9]))
  }

  it('refuses without the typed database host, and writes nothing', async () => {
    writeRun()
    const { db, updateMany } = mockDb({ findMany: [stew] })
    const d = deps({ db, env, ask: vi.fn().mockResolvedValue('ep-production.neon.tech') })

    await expect(run(parseArgs([`--publish=${dir}`]), d)).rejects.toThrow(/not confirmed/)

    expect(d.ask).toHaveBeenCalledWith(expect.stringContaining('ep-staging.neon.tech'))
    expect(updateMany).not.toHaveBeenCalled()
    expect(d.put).not.toHaveBeenCalled()
  })

  it('publishes once the host is typed back', async () => {
    writeRun()
    const { db, updateMany } = mockDb({ findMany: [stew] })
    const d = deps({
      db,
      env,
      ask: vi.fn().mockResolvedValue(' ep-staging.neon.tech\n'),
      put: vi.fn().mockResolvedValue('https://blob/new.png'),
    })

    await run(parseArgs([`--publish=${dir}`]), d)

    expect(d.put).toHaveBeenCalledTimes(1)
    expect(updateMany).toHaveBeenCalledTimes(2)
    expect(d.lines.join('\n')).toContain('Published 1, skipped 0, failed 0.')
  })

  it('honours --exclude', async () => {
    writeRun()
    const { db } = mockDb({ findMany: [stew] })
    const d = deps({ db, env, ask: vi.fn() })

    await run(parseArgs([`--publish=${dir}`, '--exclude=irish-lamb-stew']), d)

    expect(d.ask).not.toHaveBeenCalled()
    expect(d.put).not.toHaveBeenCalled()
    expect(d.lines.join('\n')).toContain('Nothing to publish.')
  })

  it('checks Blob credentials before reading the database', async () => {
    writeRun()
    const { db, findMany } = mockDb({ findMany: [stew] })
    const d = deps({ db, env: { DATABASE_URL: env.DATABASE_URL } })

    await expect(run(parseArgs([`--publish=${dir}`]), d)).rejects.toThrow(/BLOB_STORE_ID/)
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe('environment checks', () => {
  const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.y`

  it('accepts a static token', () => {
    expect(checkBlobCredentials({ BLOB_READ_WRITE_TOKEN: 't' }, NOW)).toBe('BLOB_READ_WRITE_TOKEN')
  })

  it('accepts a live OIDC token with a store id', () => {
    const token = jwt(NOW.getTime() / 1000 + 3600)
    expect(
      checkBlobCredentials({ BLOB_STORE_ID: 'store_1', VERCEL_OIDC_TOKEN: token }, NOW),
    ).toContain('store_1')
  })

  it('rejects an expired OIDC token and says how to refresh it', () => {
    const token = jwt(NOW.getTime() / 1000 - 60)
    expect(() =>
      checkBlobCredentials({ BLOB_STORE_ID: 's', VERCEL_OIDC_TOKEN: token }, NOW),
    ).toThrow(/expired[\s\S]*vercel env pull --environment=/)
  })

  it('rejects missing credentials', () => {
    expect(() => checkBlobCredentials({ BLOB_STORE_ID: 's' }, NOW)).toThrow(/VERCEL_OIDC_TOKEN/)
  })

  it('reads the database host', () => {
    expect(databaseHost('postgresql://u:p@ep-x.neon.tech:5432/db?sslmode=require')).toBe(
      'ep-x.neon.tech',
    )
    expect(() => databaseHost(undefined)).toThrow(/DATABASE_URL/)
  })

  it('confirms only an exact host, typed or passed with --yes', async () => {
    const ask = vi.fn().mockResolvedValue('db.example')
    expect(await confirmHost('db.example', { ask })).toBe(true)
    expect(await confirmHost('db.example', { ask: vi.fn().mockResolvedValue('y') })).toBe(false)
    expect(await confirmHost('db.example', { yes: 'db.example', ask })).toBe(true)
    expect(await confirmHost('db.example', { yes: 'other', ask })).toBe(false)
  })
})
