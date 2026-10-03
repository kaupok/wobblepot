/**
 * Meal footprint backfill — operator script (HON-1024)
 *
 * `generateMealImage` now fits every image it keeps: a vision call names the
 * vessel and its size, and `src/lib/meal-images/footprint.ts` scales the
 * drawing so a 27 cm plate is 0.58 of the frame width and a smaller vessel
 * narrower by its diameter. Images stored before that, or before a change
 * to the scale, keep the width they were drawn at until this script refits
 * them from the stored file. Nothing is
 * regenerated: the only AI spend is the vessel call, about $0.006 per image.
 *
 *   - Dry run (default) — fetches every ready image, classifies its vessel,
 *     fits it, and writes a before/after contact sheet (`index.html`) with
 *     the fitted files to `.temp/meal-footprints/<timestamp>/`. Writes
 *     nothing to the database or to Blob.
 *   - `--confirm` — uploads each fitted image to a new blob URL, moves
 *     `imageUrl` for every meal on the old URL with `updatedAt` pinned, as in
 *     the image route, and deletes the old blob once every meal has moved.
 *     `imageHue` does not change: the hue rule drops white and grey pixels,
 *     so scale does not affect it.
 *
 * Usage: pnpm meal-images:refit --help
 *
 * Procedure: docs/DEPLOYMENT.md § "Meal footprint backfill".
 */

import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { PrismaClient } from '../src/generated/prisma/client'
import type { FittedImage } from '../src/lib/meal-images/footprint'
import { VESSELS, type VesselEstimate } from '../src/lib/meal-images/vessel'
import {
  checkBlobCredentials,
  confirmHost,
  databaseHost,
  type Env,
} from './generate-global-meal-images'

// ============================================
// ARGS
// ============================================

export const USAGE = `Meal footprint backfill — operator script (HON-1024)

Usage:
  pnpm meal-images:refit                       Dry run: contact sheet with the fitted files, no writes
  pnpm meal-images:refit --confirm [--yes=<db host>]

  --confirm          Upload each fitted image and move imageUrl to it. Needs Blob
                     credentials for the same environment as DATABASE_URL.
  --yes=<db host>    Confirm the target database host without the prompt.

Every mode reads meals with imageStatus = ready and an imageUrl, fetches each
distinct stored image once, and asks REVIEW_MODEL for its vessel and size (about
$0.006 per image, needs ANTHROPIC_API_KEY). No image is regenerated.

Procedure: docs/DEPLOYMENT.md § "Meal footprint backfill".`

export interface ParsedArgs {
  help: boolean
  confirm: boolean
  yes?: string
}

const KNOWN_FLAGS = ['--help', '--confirm', '--yes']

export function parseArgs(argv: string[]): ParsedArgs {
  const flagOf = (a: string) => a.split('=')[0] ?? a
  const unknown = argv.filter((a) => !KNOWN_FLAGS.includes(flagOf(a)))
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(' ')}`)
  if (argv.includes('--yes')) throw new Error('--yes needs a value: --yes=<db host>')

  const args: ParsedArgs = {
    help: argv.includes('--help'),
    confirm: argv.includes('--confirm'),
    yes:
      argv
        .find((a) => a.startsWith('--yes='))
        ?.slice('--yes='.length)
        .trim() || undefined,
  }
  if (args.yes && !args.confirm) throw new Error('--yes only applies to --confirm')
  return args
}

// ============================================
// SELECTION AND FITTING
// ============================================

/** A small window onto Prisma, so tests can hand in a mock. */
export interface Db {
  meal: Pick<PrismaClient['meal'], 'findMany' | 'updateMany'>
}

export interface RefitMeal {
  id: string
  name: string
  imageUrl: string | null
  updatedAt: Date
}

export async function selectMeals(db: Db): Promise<RefitMeal[]> {
  return db.meal.findMany({
    where: { imageStatus: 'ready', imageUrl: { not: null } },
    select: { id: true, name: true, imageUrl: true, updatedAt: true },
    orderBy: { name: 'asc' },
  })
}

/** One stored image and every meal that points at it. */
export interface RefitImage {
  url: string
  meals: RefitMeal[]
  /** The vessel and its size in life, as the vision call estimated them from the food. */
  vessel: VesselEstimate | null
  /** The fitted image, or null when it could not be read or classified. */
  fitted: FittedImage | null
  error?: string
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The stored file's type from its URL; the generator stores PNG, so that is the default. */
export function mediaTypeOf(url: string): string {
  const path = url.split('?')[0] ?? url
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg'
  if (/\.webp$/i.test(path)) return 'image/webp'
  return 'image/png'
}

export interface RefitDeps {
  fetchImage: (url: string) => Promise<Uint8Array>
  classify: (image: { bytes: Uint8Array; mediaType: string }) => Promise<VesselEstimate | null>
  fit: (bytes: Uint8Array, mediaType: string, estimate: VesselEstimate) => Promise<FittedImage>
  log: (line: string) => void
  concurrency?: number
}

/**
 * Fetch, classify and fit each distinct image once, a few at a time: a
 * household's copy of a global meal shares the global meal's image. An image
 * that cannot be read or classified is reported and left as it is.
 */
export async function refit(meals: RefitMeal[], deps: RefitDeps): Promise<RefitImage[]> {
  const byUrl = new Map<string, RefitMeal[]>()
  for (const meal of meals) {
    if (!meal.imageUrl) continue
    byUrl.set(meal.imageUrl, [...(byUrl.get(meal.imageUrl) ?? []), meal])
  }
  const urls = [...byUrl.keys()]
  const images = new Map<string, RefitImage>()
  let next = 0
  const lane = async () => {
    while (next < urls.length) {
      const url = urls[next++] as string
      const group = byUrl.get(url) ?? []
      const names = [...new Set(group.map((m) => m.name))].join(', ')
      try {
        const bytes = await deps.fetchImage(url)
        const mediaType = mediaTypeOf(url)
        const vessel = await deps.classify({ bytes, mediaType })
        if (!vessel) {
          deps.log(`  ${names}: left as drawn, the vessel could not be classified`)
          images.set(url, { url, meals: group, vessel, fitted: null, error: 'not classified' })
          continue
        }
        images.set(url, {
          url,
          meals: group,
          vessel,
          fitted: await deps.fit(bytes, mediaType, vessel),
        })
      } catch (error) {
        deps.log(`  ${names}: skipped, could not read ${url}: ${messageOf(error)}`)
        images.set(url, { url, meals: group, vessel: null, fitted: null, error: messageOf(error) })
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(deps.concurrency ?? 4, urls.length) }, () => lane()),
  )
  return urls.map((url) => images.get(url) as RefitImage)
}

/** The images whose stored file changes. */
export const rescaled = (images: RefitImage[]): RefitImage[] =>
  images.filter((i) => i.fitted?.fit.action === 'fit')

/** Per vessel: how many images, their sizes, the width range as drawn, and how many move. */
export function renderSummary(images: RefitImage[]): string {
  const lines: string[] = []
  for (const vessel of VESSELS) {
    const of = images.filter((i) => i.fitted?.fit.vessel === vessel)
    if (of.length === 0) continue
    const widths = of
      .map((i) => i.fitted?.fit.measuredWidth)
      .filter((w): w is number => typeof w === 'number')
      .sort((a, b) => a - b)
    const range =
      widths.length > 0
        ? `width ${widths[0]!.toFixed(2)}–${widths[widths.length - 1]!.toFixed(2)} as drawn`
        : 'nothing drawn'
    const cms = of.map((i) => i.fitted!.fit.diameterCm).sort((a, b) => a - b)
    const sizes = `${cms[0]}–${cms[cms.length - 1]} cm`
    const fitted = of.some((i) => i.fitted!.fit.targetWidth !== null)
    const moves = of.filter((i) => i.fitted?.fit.action === 'fit').length
    const elevations = of
      .map((i) => i.fitted?.fit.elevationDeg)
      .filter((e): e is number => typeof e === 'number')
      .sort((a, b) => a - b)
    // Reported, not corrected: the model picks the camera per dish.
    const elevation =
      elevations.length > 0
        ? `, camera ${elevations[0]!.toFixed(0)}–${elevations[elevations.length - 1]!.toFixed(0)}°`
        : ''
    lines.push(
      `${vessel.padEnd(6)} ${String(of.length).padStart(3)} image(s), ${sizes}, ${range}${elevation}, ${fitted ? `${moves} to refit` : 'left as drawn'}`,
    )
  }
  const unread = images.filter((i) => !i.fitted).length
  if (unread > 0) lines.push(`${unread} image(s) could not be read or classified`)
  return lines.join('\n')
}

// ============================================
// CONTACT SHEET
// ============================================

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * A file name for the fitted image: the first meal's name, then its id, since
 * two households can each own a "Beef Bibimbap" with different images.
 */
export const fileNameFor = (image: RefitImage): string => {
  const first = image.meals[0]
  const slug = (first?.name ?? 'image')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug}-${first?.id ?? 'image'}.png`
}

/**
 * Every image as a before/after pair, each under dashed guides at the
 * width its vessel's size calls for and the rim's centre line, so a plate
 * that still misses them is seen at once. The "after" of an image left as drawn is the stored URL again.
 */
export function renderSheet(
  images: RefitImage[],
  meta: { startedAt: string; summary: string },
  afterSrc: (image: RefitImage) => string,
): string {
  const card = (src: string, target: number | null, label: string) =>
    `<figure class="card"${target === null ? '' : ` style="--t:${(target * 100).toFixed(1)}%"`}>
  <img src="${esc(src)}" alt="" loading="lazy">${target === null ? '' : '<div class="guide"></div>'}
  <figcaption>${esc(label)}</figcaption>
</figure>`
  const sections = images
    .filter((i) => i.fitted)
    .map((i) => {
      const fit = i.fitted!.fit
      const names = [...new Set(i.meals.map((m) => m.name))].join(', ')
      const moved = fit.action === 'fit'
      const camera = fit.elevationDeg === null ? '' : `, camera ${fit.elevationDeg.toFixed(0)}°`
      const before = `as drawn ${fit.measuredWidth?.toFixed(2) ?? '—'}${camera}`
      const after = moved
        ? `fitted ×${fit.scale.toFixed(2)} → ${fit.targetWidth?.toFixed(2)}`
        : `unchanged: ${fit.reason ?? fit.action}`
      return `<section class="${moved ? 'moved' : ''}">
<h2>${esc(names)} <small>${esc(fit.vessel)}, ${fit.diameterCm} cm</small></h2>
<div class="pair">${card(i.url, fit.targetWidth, before)}${card(moved ? afterSrc(i) : i.url, fit.targetWidth, after)}</div>
</section>`
    })
    .join('\n')
  const failed = images.filter((i) => !i.fitted)
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Meal footprints ${esc(meta.startedAt)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;background:#fafafa;color:#222}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:16px}
section{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px}
section.moved{border-color:#888}
h2{font-size:14px;margin:0 0 8px}
small{color:#888;font-weight:normal}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.card{position:relative;margin:0;background:#fff;border-radius:4px;overflow:hidden}
.card img{display:block;width:100%;aspect-ratio:3/2;object-fit:cover}
.guide{position:absolute;top:0;bottom:0;left:calc(50% - var(--t)/2);width:var(--t);border-left:1px dashed #c33;border-right:1px dashed #c33;pointer-events:none}
.guide::after{content:'';position:absolute;left:-50vw;right:-50vw;top:50%;border-top:1px dashed #36c}
figcaption{font-size:12px;color:#555;padding:4px 0 0}
pre{background:#fff;border:1px solid #ddd;padding:12px;display:inline-block}
</style></head><body>
<h1>Meal footprints — as drawn and fitted</h1>
<p>Run ${esc(meta.startedAt)}. ${images.length} stored image(s); ${rescaled(images).length} refit; ${failed.length} could not be read or classified. Dashed guides mark the width each vessel's size calls for, and the rim's centre line.</p>
<pre>${esc(meta.summary)}</pre>
${failed.length > 0 ? `<p>Not fitted: ${failed.map((i) => esc(i.meals.map((m) => m.name).join(', '))).join('; ')}</p>` : ''}
<div class="grid">
${sections}
</div>
</body></html>
`
}

// ============================================
// MAIN
// ============================================

export interface RunDeps extends RefitDeps {
  db: Db
  /** `putMealImage`: upload under a meal id, back the new public URL. */
  put: (mealId: string, bytes: Buffer, mediaType: string) => Promise<string>
  /** `deleteMealImage`. */
  remove: (url: string) => Promise<void>
  ask: (question: string) => Promise<string>
  env: Env
  now: () => Date
  /** Where the dry run creates its timestamped directory. */
  outRoot: string
}

export interface RunResult {
  /** Meals whose `imageUrl` now points at a fitted image. */
  moved: number
  /** Meals that changed between the read and the write, left on the old image. */
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

  const images = await refit(meals, deps)
  const summary = renderSummary(images)
  const changes = rescaled(images)
  log(`\n${summary}\n`)
  log(`${changes.length} of ${images.length} stored image(s) refit.`)

  if (!args.confirm) {
    const startedAt = deps.now().toISOString()
    const outDir = join(deps.outRoot, startedAt.replace(/[:.]/g, '-'))
    mkdirSync(outDir, { recursive: true })
    for (const image of changes)
      writeFileSync(join(outDir, fileNameFor(image)), image.fitted!.bytes)
    writeFileSync(
      join(outDir, 'index.html'),
      renderSheet(images, { startedAt, summary }, fileNameFor),
    )
    log(`Contact sheet: ${pathToFileURL(join(outDir, 'index.html')).href}`)
    log('Dry run — nothing was written. Review the sheet, then pass --confirm.')
    return
  }

  if (changes.length === 0) {
    log('Nothing to write.')
    return { moved: 0, stale: 0 }
  }
  log(`Blob: ${checkBlobCredentials(deps.env, deps.now())}`)
  if (!(await confirmHost(host, { yes: args.yes, ask: deps.ask }))) {
    throw new Error('Host not confirmed — nothing was written.')
  }

  const discard = async (url: string, why: string) => {
    try {
      await deps.remove(url)
    } catch (error) {
      log(`  could not delete ${url} (${why}): ${messageOf(error)}`)
    }
  }

  let moved = 0
  let stale = 0
  for (const image of changes) {
    const fitted = image.fitted!
    const names = [...new Set(image.meals.map((m) => m.name))].join(', ')
    // One upload per stored image, under the first meal's id; every meal on
    // the old URL moves to it.
    const newUrl = await deps.put(image.meals[0]!.id, Buffer.from(fitted.bytes), fitted.mediaType)
    let movedHere = 0
    for (const meal of image.meals) {
      // Pinned to the image and the content that were read: a meal whose image
      // was replaced, or whose content changed, since the fetch is left alone.
      // `updatedAt` is written back unchanged so Prisma's `@updatedAt` does not
      // move it (the prep-tips cache guards on it, HON-683).
      const { count } = await deps.db.meal.updateMany({
        where: { id: meal.id, imageUrl: image.url, updatedAt: meal.updatedAt },
        data: { imageUrl: newUrl, updatedAt: meal.updatedAt },
      })
      if (count === 1) movedHere++
      else {
        stale++
        log(`  ${meal.name}: changed since it was read, skipped — rerun to pick it up`)
      }
    }
    moved += movedHere
    if (movedHere === 0) {
      await discard(newUrl, 'harmless orphan')
      continue
    }
    // The old blob is only unreferenced once every meal on it has moved.
    if (movedHere === image.meals.length) await discard(image.url, 'old image, harmless orphan')
    else
      log(`  ${names}: old image kept, ${image.meals.length - movedHere} meal(s) still point at it`)
    log(`${names}  refitted ×${fitted.fit.scale.toFixed(2)}`)
  }
  log(`\nMoved ${moved} meal(s) to a fitted image; skipped ${stale} that changed during the run.`)
  return { moved, stale }
}

async function fetchImage(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  // Lazy: the unit test imports this module and must construct no client, and
  // `generate.ts` reads the validated server env on import.
  const { prisma } = await import('../src/lib/prisma')
  const { classifyVessel } = await import('../src/lib/meal-images/generate')
  const { fitFootprint } = await import('../src/lib/meal-images/footprint')
  const { deleteMealImage, putMealImage } = await import('../src/lib/meal-images/storage')
  const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    await run(args, {
      db: prisma,
      fetchImage,
      classify: (image) => classifyVessel(image),
      fit: fitFootprint,
      put: putMealImage,
      remove: deleteMealImage,
      ask: (question) => rl.question(question),
      env: process.env,
      now: () => new Date(),
      outRoot: join(repoRoot, '.temp', 'meal-footprints'),
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
    console.error(`\nrefit-meal-images failed: ${messageOf(error)}`)
    process.exitCode = 1
  })
}
