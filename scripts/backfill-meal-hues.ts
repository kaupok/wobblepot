/**
 * Meal hue backfill — operator script (HON-1009)
 *
 * `Meal.imageHue` is extracted once, when an image is stored. When the rule in
 * `src/lib/meal-images/colour.ts` changes, stored meals keep the old hue until
 * this script re-extracts it from the stored image. Nothing is regenerated, so
 * it costs no AI spend.
 *
 *   - Dry run (default) — fetches every ready image, extracts its hue with the
 *     current rule, writes a before/after contact sheet (`index.html`) to
 *     `.temp/meal-hues/<timestamp>/` and prints a 20° histogram of the old and
 *     new hues. Writes nothing to the database.
 *   - `--baseline` — prints a new `HUE_BASELINE` from the same images. This is
 *     how the constant in `colour.ts` is produced.
 *   - `--confirm` — writes the new `imageHue` values after the operator types
 *     the database host back. Only `imageHue` changes: `updatedAt` is pinned,
 *     as in the image route.
 *
 * Usage: pnpm meal-images:rehue --help
 *
 * Procedure: docs/DEPLOYMENT.md § "Meal hue backfill".
 */

import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { PrismaClient } from '../src/generated/prisma/client'
import { DEFAULT_HUE_OPTIONS, extractHue, type HueResult } from '../src/lib/meal-images/colour'
import { confirmHost, databaseHost, type Env } from './generate-global-meal-images'

// ============================================
// ARGS
// ============================================

export const USAGE = `Meal hue backfill — operator script (HON-1009)

Usage:
  pnpm meal-images:rehue                       Dry run: contact sheet and histogram, no writes
  pnpm meal-images:rehue --baseline            Print a new HUE_BASELINE for colour.ts
  pnpm meal-images:rehue --confirm [--yes=<db host>]

  --baseline         Print the mean hue-bin shares of every ready image, as the
                     HUE_BASELINE constant. Writes nothing.
  --confirm          Write the new imageHue values. Only imageHue changes.
  --yes=<db host>    Confirm the target database host without the prompt.

Every mode reads meals with imageStatus = ready and an imageUrl, and fetches
the stored image. No image is regenerated, so no mode costs AI spend.

Procedure: docs/DEPLOYMENT.md § "Meal hue backfill".`

export interface ParsedArgs {
  help: boolean
  baseline: boolean
  confirm: boolean
  yes?: string
}

const KNOWN_FLAGS = ['--help', '--baseline', '--confirm', '--yes']

export function parseArgs(argv: string[]): ParsedArgs {
  const flagOf = (a: string) => a.split('=')[0] ?? a
  const unknown = argv.filter((a) => !KNOWN_FLAGS.includes(flagOf(a)))
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(' ')}`)
  if (argv.includes('--yes')) throw new Error('--yes needs a value: --yes=<db host>')

  const args: ParsedArgs = {
    help: argv.includes('--help'),
    baseline: argv.includes('--baseline'),
    confirm: argv.includes('--confirm'),
    yes:
      argv
        .find((a) => a.startsWith('--yes='))
        ?.slice('--yes='.length)
        .trim() || undefined,
  }
  if (args.baseline && args.confirm) {
    throw new Error('--baseline cannot be combined with --confirm')
  }
  if (args.yes && !args.confirm) throw new Error('--yes only applies to --confirm')
  return args
}

// ============================================
// SELECTION AND EXTRACTION
// ============================================

/** A small window onto Prisma, so tests can hand in a mock. */
export interface Db {
  meal: Pick<PrismaClient['meal'], 'findMany' | 'updateMany'>
}

export interface RehueMeal {
  id: string
  name: string
  imageUrl: string | null
  imageHue: number | null
  updatedAt: Date
}

export async function selectMeals(db: Db): Promise<RehueMeal[]> {
  return db.meal.findMany({
    where: { imageStatus: 'ready', imageUrl: { not: null } },
    select: { id: true, name: true, imageUrl: true, imageHue: true, updatedAt: true },
    orderBy: { name: 'asc' },
  })
}

export interface RehueRow {
  meal: RehueMeal
  /** The hue under the current rule, or null when the image could not be read. */
  result: HueResult | null
  error?: string
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Fetch and re-extract each distinct image once, a few at a time, and give
 * every meal the result for its URL: a household's copy of a global meal
 * shares the global meal's image. A failure skips the meals on that URL.
 */
export async function rehue(
  meals: RehueMeal[],
  deps: {
    fetchImage: (url: string) => Promise<Uint8Array>
    extract: (bytes: Uint8Array) => Promise<HueResult>
    log: (line: string) => void
    concurrency?: number
  },
): Promise<RehueRow[]> {
  const urls = [...new Set(meals.map((m) => m.imageUrl ?? ''))]
  const byUrl = new Map<string, { result: HueResult } | { error: string }>()
  let next = 0
  const lane = async () => {
    while (next < urls.length) {
      const url = urls[next++] as string
      try {
        byUrl.set(url, { result: await deps.extract(await deps.fetchImage(url)) })
      } catch (error) {
        const names = [...new Set(meals.filter((m) => m.imageUrl === url).map((m) => m.name))]
        deps.log(`  ${names.join(', ')}: skipped, could not read ${url}: ${messageOf(error)}`)
        byUrl.set(url, { error: messageOf(error) })
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(deps.concurrency ?? 4, urls.length) }, () => lane()),
  )
  return meals.map((meal) => {
    const read = byUrl.get(meal.imageUrl ?? '')
    return read && 'result' in read
      ? { meal, result: read.result }
      : { meal, result: null, error: read && 'error' in read ? read.error : 'not read' }
  })
}

// ============================================
// BASELINE
// ============================================

/**
 * The mean share per bin over images that carry any chroma. An image with no
 * chroma has no shares to average (0 / 0) and no hue under any rule.
 */
export function meanShares(binsPerImage: number[][], binCount: number): number[] {
  const sums = new Array<number>(binCount).fill(0)
  let n = 0
  for (const bins of binsPerImage) {
    const total = bins.reduce((a, b) => a + b, 0)
    if (total === 0) continue
    n++
    for (let b = 0; b < binCount; b++) sums[b] = (sums[b] ?? 0) + (bins[b] ?? 0) / total
  }
  return sums.map((s) => (n === 0 ? 0 : s / n))
}

/** The `HUE_BASELINE` declaration, ready to paste into `colour.ts`. */
export function formatBaseline(values: number[], meta: { date: string; count: number }): string {
  const rows: string[] = []
  for (let i = 0; i < values.length; i += 6) {
    rows.push(
      '  ' +
        values
          .slice(i, i + 6)
          .map((v) => v.toFixed(4))
          .join(', ') +
        ',',
    )
  }
  return [
    `// Produced on ${meta.date} by \`pnpm meal-images:rehue --baseline\` from ${meta.count} images.`,
    'export const HUE_BASELINE: readonly number[] = [',
    ...rows,
    ']',
  ].join('\n')
}

// ============================================
// HISTOGRAM
// ============================================

export const HISTOGRAM_STEP = 20

/** Hues counted per 20° bucket (0–19, 20–39, …), plus the meals with no hue. */
export function hueHistogram(hues: (number | null)[]): { buckets: number[]; none: number } {
  const buckets = new Array<number>(360 / HISTOGRAM_STEP).fill(0)
  let none = 0
  for (const hue of hues) {
    if (hue === null) {
      none++
      continue
    }
    const b = Math.floor((((hue % 360) + 360) % 360) / HISTOGRAM_STEP)
    buckets[b] = (buckets[b] ?? 0) + 1
  }
  return { buckets, none }
}

/** Old and new hue counts per bucket, side by side, as text. */
export function renderHistogram(before: (number | null)[], after: (number | null)[]): string {
  const a = hueHistogram(before)
  const b = hueHistogram(after)
  const bar = (n: number) => '#'.repeat(n)
  const width = Math.max(3, ...a.buckets.map((n) => bar(n).length), bar(a.none).length)
  const line = (label: string, x: number, y: number) =>
    `${label.padEnd(8)} ${String(x).padStart(3)} ${bar(x).padEnd(width)}  ${String(y).padStart(3)} ${bar(y)}`
  return [
    `${'hue'.padEnd(8)} ${'old'.padStart(3)} ${''.padEnd(width)}  ${'new'.padStart(3)}`,
    ...a.buckets.map((x, i) =>
      line(
        `${i * HISTOGRAM_STEP}–${i * HISTOGRAM_STEP + HISTOGRAM_STEP - 1}`,
        x,
        b.buckets[i] ?? 0,
      ),
    ),
    line('none', a.none, b.none),
  ].join('\n')
}

// ============================================
// CONTACT SHEET
// ============================================

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * One card per hue, painted with the light-theme tokens from `globals.css`
 * (`--meal-surface-*`, `--meal-chip-*`, `--meal-text-*`). A null hue paints
 * the neutral surface: the tokens' lightness at zero chroma.
 */
function card(imageUrl: string, hue: number | null, label: string): string {
  const h = hue ?? 0
  const c = (chroma: number) => (hue === null ? 0 : chroma)
  return `<div class="card" style="background:oklch(0.97 ${c(0.035)} ${h});color:oklch(0.25 ${c(0.03)} ${h})">
  <img src="${esc(imageUrl)}" alt="" loading="lazy">
  <span class="chip" style="background:oklch(0.9 ${c(0.11)} ${h})">${esc(label)} ${hue === null ? 'none' : `${hue}°`}</span>
</div>`
}

export function renderSheet(rows: RehueRow[], meta: { startedAt: string; histogram: string }) {
  const sections = rows
    .filter((r) => r.result && r.meal.imageUrl)
    .map((r) => {
      const before = r.meal.imageHue
      const after = r.result?.hue ?? null
      const changed = before !== after
      return `<section class="${changed ? 'changed' : ''}">
<h2>${esc(r.meal.name)}${changed ? '' : ' <small>(unchanged)</small>'}</h2>
<div class="pair">${card(r.meal.imageUrl ?? '', before, 'old')}${card(r.meal.imageUrl ?? '', after, 'new')}</div>
</section>`
    })
    .join('\n')
  const failed = rows.filter((r) => !r.result)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Meal hues ${esc(meta.startedAt)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;background:#fafafa;color:#222}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px}
section{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px}
section.changed{border-color:#888}
h2{font-size:14px;margin:0 0 8px}
small{color:#888;font-weight:normal}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.card{border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px}
.card img{width:100%;aspect-ratio:3/2;object-fit:cover;mix-blend-mode:multiply;border-radius:4px}
.chip{align-self:flex-start;border-radius:999px;padding:2px 8px;font-size:12px}
pre{background:#fff;border:1px solid #ddd;padding:12px;display:inline-block}
</style></head><body>
<h1>Meal hues — old rule and new rule</h1>
<p>Run ${esc(meta.startedAt)}. ${rows.length} meals with a ready image; ${rows.filter((r) => r.result && r.meal.imageHue !== r.result.hue).length} change hue; ${failed.length} could not be read.</p>
<pre>${esc(meta.histogram)}</pre>
${failed.length > 0 ? `<p>Not read: ${failed.map((r) => esc(r.meal.name)).join(', ')}</p>` : ''}
<div class="grid">
${sections}
</div>
</body></html>
`
}

// ============================================
// MAIN
// ============================================

export interface RunDeps {
  db: Db
  fetchImage: (url: string) => Promise<Uint8Array>
  extract: (bytes: Uint8Array) => Promise<HueResult>
  ask: (question: string) => Promise<string>
  env: Env
  now: () => Date
  /** Where the dry run creates its timestamped directory. */
  outRoot: string
  log: (line: string) => void
}

export interface RunResult {
  written: number
  stale: number
}

export async function run(args: ParsedArgs, deps: RunDeps): Promise<RunResult | undefined> {
  const { log } = deps
  if (args.help) {
    log(USAGE)
    return
  }

  const host = databaseHost(deps.env.DATABASE_URL)
  const meals = await selectMeals(deps.db)
  log(`${meals.length} meal(s) with a ready image on ${host}`)
  if (meals.length === 0) return

  const rows = await rehue(meals, deps)
  const read = rows.filter((r): r is RehueRow & { result: HueResult } => r.result !== null)

  if (args.baseline) {
    // Per image, not per meal: copies of a global meal would weight its
    // image once per household.
    const images = [...new Map(read.map((r) => [r.meal.imageUrl, r.result.bins])).values()]
    const date = deps.now().toISOString().slice(0, 10)
    const values = meanShares(images, DEFAULT_HUE_OPTIONS.bins)
    const count = images.filter((bins) => bins.some((v) => v > 0)).length
    log(`\nPaste into src/lib/meal-images/colour.ts:\n`)
    log(formatBaseline(values, { date, count }))
    return
  }

  const histogram = renderHistogram(
    read.map((r) => r.meal.imageHue),
    read.map((r) => r.result.hue),
  )
  const changes = read.filter((r) => r.meal.imageHue !== r.result.hue)
  log(`\n${histogram}\n`)
  log(
    `${changes.length} of ${read.length} hue(s) change; ${rows.length - read.length} image(s) could not be read.`,
  )

  if (!args.confirm) {
    const startedAt = deps.now().toISOString()
    const outDir = join(deps.outRoot, startedAt.replace(/[:.]/g, '-'))
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'index.html'), renderSheet(rows, { startedAt, histogram }))
    log(`Contact sheet: ${pathToFileURL(join(outDir, 'index.html')).href}`)
    log('Dry run — nothing was written. Review the sheet, then pass --confirm.')
    return
  }

  if (changes.length === 0) {
    log('Nothing to write.')
    return { written: 0, stale: 0 }
  }
  if (!(await confirmHost(host, { yes: args.yes, ask: deps.ask }))) {
    throw new Error('Host not confirmed — nothing was written.')
  }

  let written = 0
  let stale = 0
  for (const { meal, result } of changes) {
    // Pinned to the image and the content that were read: a meal whose image
    // was replaced, or whose content changed, since the fetch is left alone.
    // `updatedAt` is written back unchanged so Prisma's `@updatedAt` does not
    // move it (the prep-tips cache guards on it, HON-683).
    const { count } = await deps.db.meal.updateMany({
      where: { id: meal.id, imageUrl: meal.imageUrl, updatedAt: meal.updatedAt },
      data: { imageHue: result.hue, updatedAt: meal.updatedAt },
    })
    if (count === 1) written++
    else {
      stale++
      log(`  ${meal.name}: changed since it was read, skipped — rerun to pick it up`)
    }
  }
  log(`\nWrote ${written} hue(s); skipped ${stale} meal(s) that changed during the run.`)
  return { written, stale }
}

async function fetchImage(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  // Lazy: the unit test imports this module and must construct no client.
  const { prisma } = await import('../src/lib/prisma')
  const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    await run(args, {
      db: prisma,
      fetchImage,
      extract: (bytes) => extractHue(bytes),
      ask: (question) => rl.question(question),
      env: process.env,
      now: () => new Date(),
      outRoot: join(repoRoot, '.temp', 'meal-hues'),
      // eslint-disable-next-line no-console
      log: (line) => console.log(line),
    })
  } finally {
    rl.close()
    await prisma.$disconnect()
  }
}

// Guarded so the unit test can import the helpers without touching anything.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`\nbackfill-meal-hues failed: ${messageOf(error)}`)
    process.exitCode = 1
  })
}
