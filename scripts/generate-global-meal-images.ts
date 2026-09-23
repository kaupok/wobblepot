/**
 * Global meal illustrations — operator batch (HON-738)
 *
 * Global meals (`householdId` null) are shown to every household, so the lazy
 * route (`POST /api/meals/[id]/image`, HON-735) never draws them: one
 * household's AI cap must not pay for a shared asset. An operator pays once,
 * here, in two phases so nothing unreviewed goes live:
 *
 *   1. Generate  — `--confirm` draws every selected meal into
 *      `.temp/global-meal-images/<timestamp>/` with a contact sheet
 *      (`index.html`) and a `manifest.json`. Writes nothing to the database
 *      or to Blob. Without `--confirm` it is a dry run: count and cost only.
 *   2. Publish   — `--publish=<run dir>` uploads the reviewed images through
 *      `putMealImage` and sets `imageUrl`, `imageStatus`, `imagePromptVersion`
 *      and `imageHue` (HON-744).
 *      `--exclude=slug,slug` leaves the rejected ones out; the next
 *      `--confirm` run selects them again.
 *
 * Generation does not depend on the environment, so one run directory can be
 * published to staging first and to production after. Meal ids differ between
 * those databases, so the manifest is keyed by the slug of the English name,
 * and publish refuses any meal whose prompt no longer matches the one drawn.
 *
 * COSTS REAL MONEY with `--confirm` (~$0.042 per image, ~$0.008 more per
 * image with `--judge`). Spend is printed, never ledgered: no household owns
 * it, so `recordAiUsage` is not called.
 *
 * Usage: pnpm meal-images:global --help (flags, and why `--concurrency` defaults to 1)
 *
 * Procedure: docs/DEPLOYMENT.md § "Global meal illustrations".
 */

import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Prisma, PrismaClient } from '../src/generated/prisma/client'
import { extractHue } from '../src/lib/meal-images/colour'
import type { GeneratedMealImage, GenerateMealImageOptions } from '../src/lib/meal-images/generate'
import type { JudgeVerdict } from '../src/lib/meal-images/judge'
import {
  buildMealImagePrompt,
  MEAL_IMAGE_PROMPT_VERSION,
  type MealImageMeal,
} from '../src/lib/meal-images/prompt'
import {
  extensionFor,
  MODELS,
  renderContactSheet,
  slugify,
  variantsFor,
  type JobResult,
  type SpikeMeal,
} from './spike-meal-images'

// ============================================
// ARGS
// ============================================

/** HON-733's measured price for one `gpt-image-2.5-flare` image at 1536×1024, high. */
export const IMAGE_EST_USD = 0.0422
/** HON-733's measured judge call (`REVIEW_MODEL` vision). */
export const JUDGE_EST_USD = 0.0075
/**
 * One image at a time. The OpenAI tier allows 5 images per minute, and one
 * image takes ~18 s, so a single lane already runs close to the limit; four
 * lanes lost 4 of 16 images to 429s on the first real run (HON-742).
 */
const DEFAULT_CONCURRENCY = 1
/** The OpenAI organisation's image rate limit for `gpt-image-2.5-flare` (HON-742). */
export const TIER_IMAGES_PER_MINUTE = 5

export const USAGE = `Global meal illustrations — operator batch (HON-738)

Usage:
  pnpm meal-images:global [--confirm] [--judge] [--limit=N] [--meal=<id or name>] [--concurrency=N]
  pnpm meal-images:global --publish=<run dir> [--exclude=slug,slug] [--yes=<db host>]

Generate (without --confirm: a free dry run that prints the count and cost):
  --confirm          Draw the images into .temp/global-meal-images/<timestamp>/. COSTS MONEY.
  --judge            Add the report-only vision judge to each contact-sheet cell.
  --limit=N          Draw at most N meals.
  --meal=<id|name>   Draw one meal, by id or English name.
  --concurrency=N    Images in flight at once. Default ${DEFAULT_CONCURRENCY}: the OpenAI tier allows
                     ${TIER_IMAGES_PER_MINUTE} images per minute, and one lane already runs close to it.
                     More lanes mostly add rate-limit waits (a 429 is retried after
                     15 s, 30 s and 60 s, then the meal fails).

Publish:
  --publish=<dir>    Upload the reviewed images in <dir> and set the image columns.
  --exclude=a,b      Leave the rejected slugs out; the next --confirm redraws them.
  --yes=<db host>    Confirm the target database host without the prompt.

Procedure: docs/DEPLOYMENT.md § "Global meal illustrations".`

/** Same as the route's `CLAIM_STALE_MS`: a claim older than this belongs to a dead process. */
export const CLAIM_STALE_MS = 3 * 60_000

export interface ParsedArgs {
  help: boolean
  confirm: boolean
  judge: boolean
  limit?: number
  meal?: string
  concurrency: number
  publish?: string
  exclude: string[]
  yes?: string
}

const valueOf = (argv: string[], flag: string): string | undefined =>
  argv.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1)

function positiveInt(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`${flag} must be a positive integer, got "${raw}"`)
  return n
}

/** Comma-separated slugs, trimmed, lower-cased, de-duplicated; empty items dropped. */
export function parseExclude(raw: string | undefined): string[] {
  if (!raw) return []
  return [
    ...new Set(
      raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
}

const KNOWN_FLAGS = [
  '--help',
  '--confirm',
  '--judge',
  '--limit',
  '--meal',
  '--concurrency',
  '--publish',
  '--exclude',
  '--yes',
]

export function parseArgs(argv: string[]): ParsedArgs {
  const flagOf = (a: string) => a.split('=')[0] ?? a
  const unknown = argv.filter((a) => !KNOWN_FLAGS.includes(flagOf(a)))
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(' ')}`)

  const bare = ['--limit', '--meal', '--concurrency', '--exclude', '--yes'].filter((f) =>
    argv.includes(f),
  )
  if (bare.length > 0) throw new Error(`${bare.join(', ')} needs a value: ${bare[0]}=<value>`)

  const publish = valueOf(argv, '--publish')
  const args: ParsedArgs = {
    help: argv.includes('--help'),
    confirm: argv.includes('--confirm'),
    judge: argv.includes('--judge'),
    limit: positiveInt(valueOf(argv, '--limit'), '--limit'),
    meal: valueOf(argv, '--meal')?.trim() || undefined,
    concurrency:
      positiveInt(valueOf(argv, '--concurrency'), '--concurrency') ?? DEFAULT_CONCURRENCY,
    publish: publish?.trim() || undefined,
    exclude: parseExclude(valueOf(argv, '--exclude')),
    yes: valueOf(argv, '--yes')?.trim() || undefined,
  }

  if (argv.some((a) => a === '--publish') || (publish !== undefined && !args.publish)) {
    throw new Error('--publish needs a run directory: --publish=<run dir>')
  }
  if (args.publish) {
    const clash = ['--confirm', '--judge', '--limit', '--meal', '--concurrency'].filter((f) =>
      argv.some((a) => flagOf(a) === f),
    )
    if (clash.length > 0) {
      throw new Error(`${clash.join(', ')} cannot be combined with --publish`)
    }
  } else if (args.exclude.length > 0 || args.yes) {
    throw new Error('--exclude and --yes only apply to --publish')
  }
  return args
}

// ============================================
// SELECTION
// ============================================

/** `process.env`, loosely: the typed `ProcessEnv` insists on `NODE_ENV`. */
export type Env = Record<string, string | undefined>

/** A small window onto Prisma, so tests can hand in a mock. */
export interface Db {
  meal: Pick<PrismaClient['meal'], 'findMany' | 'updateMany'>
}

export const MEAL_SELECT = {
  id: true,
  name: true,
  description: true,
  preparationNotes: true,
  updatedAt: true,
  imageUrl: true,
  imageStatus: true,
  imagePromptVersion: true,
  components: {
    // A stable order: `ingredientsByWeight` keeps row order on equal weights, and
    // publish compares prompts built from two databases whose row order differs.
    orderBy: { ingredient: { name: 'asc' } },
    select: {
      quantityPerServing: true,
      ingredient: {
        select: { name: true, defaultUnit: true, gramsPerPiece: true, densityGPerMl: true },
      },
    },
  },
} satisfies Prisma.MealSelect

export type GlobalMeal = Prisma.MealGetPayload<{ select: typeof MEAL_SELECT }>

/**
 * Not `ready` at the current prompt version. Spelled out as three branches
 * because `{ not: 'v3' }` compiles to `<> 'v3'`, which is never true for NULL.
 */
export const NEEDS_IMAGE: Prisma.MealWhereInput = {
  OR: [
    { imageStatus: { not: 'ready' } },
    { imagePromptVersion: null },
    { imagePromptVersion: { not: MEAL_IMAGE_PROMPT_VERSION } },
  ],
}

export function selectionWhere(meal?: string): Prisma.MealWhereInput {
  return {
    householdId: null,
    deletedAt: null,
    AND: [
      NEEDS_IMAGE,
      ...(meal
        ? [{ OR: [{ id: meal }, { name: { equals: meal, mode: 'insensitive' as const } }] }]
        : []),
    ],
  }
}

/** Global meals that need an image, by name, capped at `limit`. */
export async function selectMeals(
  db: Db,
  opts: Pick<ParsedArgs, 'limit' | 'meal'>,
): Promise<GlobalMeal[]> {
  return db.meal.findMany({
    where: selectionWhere(opts.meal),
    select: MEAL_SELECT,
    orderBy: { name: 'asc' },
    ...(opts.limit !== undefined && { take: opts.limit }),
  })
}

/**
 * Keep only the `meals` whose slug no other global meal shares. Publish finds
 * a meal by slug among *all* global meals (ids differ per database) and skips
 * a shared one, so drawing it would be paid for on every run and never used.
 * `all` is every non-deleted global meal's name, ready or not.
 */
export function uniqueBySlug<T extends { name: string }>(
  meals: T[],
  all: { name: string }[],
): { unique: T[]; ambiguous: string[] } {
  const counts = new Map<string, number>()
  for (const m of all) counts.set(slugify(m.name), (counts.get(slugify(m.name)) ?? 0) + 1)
  const shared = (m: { name: string }) => (counts.get(slugify(m.name)) ?? 0) > 1
  return {
    unique: meals.filter((m) => !shared(m)),
    ambiguous: [...new Set(meals.filter(shared).map((m) => slugify(m.name)))],
  }
}

/**
 * The route's mapping (`src/app/api/meals/[id]/image/route.ts`). `Meal.name`
 * and `description` are the English source; translations live in
 * `MealTranslation`, and one image serves every locale.
 */
export function toMealImageMeal(meal: GlobalMeal): MealImageMeal {
  return {
    name: meal.name,
    description: meal.description,
    preparationNotes: meal.preparationNotes,
    components: meal.components.map((c) => ({
      name: c.ingredient.name,
      quantity: c.quantityPerServing,
      unit: c.ingredient.defaultUnit,
      gramsPerPiece: c.ingredient.gramsPerPiece,
      densityGPerMl: c.ingredient.densityGPerMl,
    })),
  }
}

export function estimateUsd(count: number, judge: boolean): number {
  return count * (IMAGE_EST_USD + (judge ? JUDGE_EST_USD : 0))
}

// ============================================
// GENERATE (--confirm)
// ============================================

export interface ManifestEntry {
  slug: string
  name: string
  /** Id in the database the run selected from — informational; publish matches by slug. */
  sourceMealId: string
  /** The exact prompt drawn. Publish refuses a meal whose prompt has changed since. */
  prompt: string
  /** Relative to the run dir; absent when generation failed. */
  file?: string
  mediaType?: string
  usd?: number
  latencyMs: number
  verdict?: JudgeVerdict | null
  /** The card hue the route would store (HON-744); null when the image carries no colour. */
  hue?: number | null
  error?: string
}

export interface Manifest {
  startedAt: string
  promptVersion: string
  judge: boolean
  entries: ManifestEntry[]
}

export type GenerateFn = (
  meal: MealImageMeal,
  options: GenerateMealImageOptions,
) => Promise<GeneratedMealImage>

/**
 * Per-image ceiling: an image is ~18 s, a judge ~3.4 s, and a rate-limited
 * image may wait up to 105 s between its four attempts (HON-742). Generous,
 * but a hung call must end.
 */
const IMAGE_TIMEOUT_MS = 300_000

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The meal's card hue from the image bytes (HON-744). As in the route, a
 * failure is logged and yields null: it must never cost a paid image.
 */
async function hueOf(
  bytes: Uint8Array,
  slug: string,
  log: (line: string) => void,
): Promise<number | null> {
  try {
    return (await extractHue(bytes)).hue
  } catch (error) {
    log(`  ${slug}: could not extract the hue, storing null: ${messageOf(error)}`)
    return null
  }
}

/** Run `worker` over `items`, at most `concurrency` at a time. */
async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let next = 0
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await worker(items[next++] as T)
  })
  await Promise.all(lanes)
}

export function toSpikeMeal(entry: ManifestEntry, meal: MealImageMeal): SpikeMeal {
  return {
    slug: entry.slug,
    name: meal.name,
    description: meal.description ?? '',
    components: meal.components.map((c) => ({ name: c.name, quantity: c.quantity, unit: c.unit })),
    preparationNotes: meal.preparationNotes ?? undefined,
  }
}

/** A manifest entry as a row of the spike's contact sheet: flare, illustration, V3. */
export function toJobResult(entry: ManifestEntry): JobResult {
  const verdict = entry.verdict
  return {
    modelKey: 'flare',
    mealSlug: entry.slug,
    styleId: 'illustration',
    version: 'v3',
    repeat: 1,
    prompt: entry.prompt,
    latencyMs: entry.latencyMs,
    file: entry.file,
    usd: entry.usd,
    costMeasured: entry.usd !== undefined,
    error: entry.error,
    ...(verdict && {
      // Filtered findings, as the route's gate reads them; raw ones are in manifest.json.
      judgeV2: {
        ...verdict.filtered,
        pass: verdict.pass,
        strictPass: verdict.strictPass,
        latencyMs: 0,
        usd: 0,
      },
    }),
  }
}

export function renderSheet(manifest: Manifest, meals: SpikeMeal[]): string {
  return renderContactSheet(manifest.entries.map(toJobResult), {
    startedAt: manifest.startedAt,
    models: MODELS.filter((m) => m.key === 'flare'),
    variants: variantsFor({ styles: ['illustration'], versions: ['v3'] }),
    meals,
    title: `Global meal illustrations (HON-738) — prompt ${manifest.promptVersion}${manifest.judge ? ', judge report-only' : ', no judge'}`,
  })
}

export interface GenerateDeps {
  generate: GenerateFn
  log: (line: string) => void
}

/**
 * Draw every meal into `outDir` and write `manifest.json` and `index.html`.
 * Touches neither the database nor Blob. The manifest is rewritten after each
 * image, so a crash mid-run still leaves a record of what was paid for.
 */
export async function runGenerate(
  meals: GlobalMeal[],
  opts: { outDir: string; judge: boolean; concurrency: number; startedAt: string },
  deps: GenerateDeps,
): Promise<Manifest> {
  mkdirSync(opts.outDir, { recursive: true })
  const manifest: Manifest = {
    startedAt: opts.startedAt,
    promptVersion: MEAL_IMAGE_PROMPT_VERSION,
    judge: opts.judge,
    entries: [],
  }
  const inputs = new Map<string, MealImageMeal>()
  const save = () =>
    writeFileSync(join(opts.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  let done = 0
  await pool(meals, opts.concurrency, async (meal) => {
    const input = toMealImageMeal(meal)
    const slug = slugify(meal.name)
    inputs.set(slug, input)
    const base = {
      slug,
      name: meal.name,
      sourceMealId: meal.id,
      prompt: buildMealImagePrompt(input),
    }
    const t0 = performance.now()
    let entry: ManifestEntry
    try {
      const image = await deps.generate(input, {
        judge: opts.judge ? 'report' : 'off',
        mealId: meal.id,
        abortSignal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      })
      const file = `${slug}.${extensionFor(image.mediaType)}`
      writeFileSync(join(opts.outDir, file), image.bytes)
      entry = {
        ...base,
        file,
        mediaType: image.mediaType,
        usd: image.totalUsd,
        latencyMs: performance.now() - t0,
        verdict: image.verdict,
        hue: await hueOf(image.bytes, slug, deps.log),
      }
    } catch (error) {
      entry = { ...base, latencyMs: performance.now() - t0, error: messageOf(error) }
    }
    manifest.entries.push(entry)
    save()
    done += 1
    const verdict = entry.verdict ? `  judge ${entry.verdict.pass ? 'PASS' : 'FAIL'}` : ''
    deps.log(
      entry.error
        ? `[${done}/${meals.length}] ${slug}  FAILED: ${entry.error}`
        : `[${done}/${meals.length}] ${slug}  ${(entry.latencyMs / 1000).toFixed(1)}s  $${(entry.usd ?? 0).toFixed(4)}${verdict}`,
    )
  })

  // Contact sheet rows in name order, whatever order the pool finished in.
  manifest.entries.sort((a, b) => a.name.localeCompare(b.name))
  save()
  const spikeMeals = manifest.entries.map((e) => toSpikeMeal(e, inputs.get(e.slug)!))
  writeFileSync(join(opts.outDir, 'index.html'), renderSheet(manifest, spikeMeals))
  return manifest
}

/** Images drawn per minute of wall-clock time; 0 before any time has passed. */
export function imagesPerMinute(count: number, elapsedMs: number): number {
  return elapsedMs > 0 ? count / (elapsedMs / 60_000) : 0
}

export const totalUsdOf = (manifest: Manifest): number =>
  manifest.entries.reduce((sum, e) => sum + (e.usd ?? 0), 0)

// ============================================
// PUBLISH (--publish)
// ============================================

export function readManifest(runDir: string): Manifest {
  const path = join(runDir, 'manifest.json')
  if (!existsSync(path))
    throw new Error(`No manifest.json in ${runDir} — is this a --confirm run dir?`)
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest
  if (!Array.isArray(manifest.entries) || typeof manifest.promptVersion !== 'string') {
    throw new Error(`${path} is not a global meal image manifest`)
  }
  return manifest
}

export type PlanItem =
  | {
      action: 'publish'
      entry: ManifestEntry & { file: string; mediaType: string }
      meal: GlobalMeal
    }
  | { action: 'skip'; slug: string; reason: string }

export interface PublishPlan {
  items: PlanItem[]
  /** `--exclude` slugs the manifest does not contain — most likely a typo. */
  unknownExcludes: string[]
}

const isReady = (m: Pick<GlobalMeal, 'imageStatus' | 'imagePromptVersion'>) =>
  m.imageStatus === 'ready' && m.imagePromptVersion === MEAL_IMAGE_PROMPT_VERSION

/**
 * Decide, per manifest entry, whether to publish it to the target database.
 * Pure: `targets` is every non-deleted global meal read from that database.
 */
export function buildPublishPlan(
  manifest: Manifest,
  targets: GlobalMeal[],
  exclude: string[],
): PublishPlan {
  if (manifest.promptVersion !== MEAL_IMAGE_PROMPT_VERSION) {
    throw new Error(
      `Run was drawn with prompt ${manifest.promptVersion}, but the current version is ${MEAL_IMAGE_PROMPT_VERSION}. Generate a new run with --confirm.`,
    )
  }
  const bySlug = new Map<string, GlobalMeal[]>()
  for (const meal of targets) {
    const slug = slugify(meal.name)
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), meal])
  }
  const excluded = new Set(exclude)

  const items = manifest.entries.map((entry): PlanItem => {
    const skip = (reason: string): PlanItem => ({ action: 'skip', slug: entry.slug, reason })
    if (excluded.has(entry.slug)) return skip('excluded by the operator')
    if (entry.error || !entry.file || !entry.mediaType) return skip('generation failed')
    const matches = bySlug.get(entry.slug) ?? []
    const meal = matches[0]
    if (!meal) return skip('no global meal with this name in the target database')
    if (matches.length > 1) return skip(`${matches.length} global meals share this name`)
    if (isReady(meal)) return skip(`already ready at ${MEAL_IMAGE_PROMPT_VERSION}`)
    if (buildMealImagePrompt(toMealImageMeal(meal)) !== entry.prompt) {
      return skip('the meal changed since it was drawn — regenerate it')
    }
    return {
      action: 'publish',
      entry: { ...entry, file: entry.file, mediaType: entry.mediaType },
      meal,
    }
  })

  const slugs = new Set(manifest.entries.map((e) => e.slug))
  return { items, unknownExcludes: exclude.filter((s) => !slugs.has(s)) }
}

export interface PublishDeps {
  db: Db
  put: (mealId: string, bytes: Buffer, mediaType: string) => Promise<string>
  remove: (url: string) => Promise<void>
  readFile: (path: string) => Buffer
  now: () => Date
  log: (line: string) => void
}

export interface PublishResult {
  published: string[]
  skipped: { slug: string; reason: string }[]
  failed: { slug: string; error: string }[]
}

/**
 * Upload and attach each planned image under a claim, with the route's
 * columns and guarded-`updateMany` idiom:
 *
 * - Claim: set `imageClaimedAt` only while the meal still needs an image, no
 *   live claim holds it, and `updatedAt` is what the plan read. A concurrent
 *   publish of the same meal matches nothing and skips it.
 * - Attach: write the image columns only while the claim still holds.
 *   `clearMealImage` (HON-734) resets `imageClaimedAt` on any content edit,
 *   so an edit mid-upload makes this match nothing, and the blob is deleted.
 *
 * `updatedAt` is written back unchanged, as in the route, so publishing an
 * image does not look like a content edit to the prep-tips cache (HON-683).
 */
export async function runPublish(
  plan: PublishPlan,
  runDir: string,
  deps: PublishDeps,
): Promise<PublishResult> {
  const result: PublishResult = { published: [], skipped: [], failed: [] }
  const discard = async (url: string) => {
    try {
      await deps.remove(url)
    } catch (error) {
      deps.log(`  could not delete ${url} (harmless orphan): ${messageOf(error)}`)
    }
  }

  for (const item of plan.items) {
    if (item.action === 'skip') {
      result.skipped.push({ slug: item.slug, reason: item.reason })
      continue
    }
    const { entry, meal } = item
    const claimedAt = deps.now()
    const staleBefore = new Date(claimedAt.getTime() - CLAIM_STALE_MS)

    const claim = await deps.db.meal.updateMany({
      where: {
        id: meal.id,
        householdId: null,
        deletedAt: null,
        updatedAt: meal.updatedAt,
        AND: [
          NEEDS_IMAGE,
          { OR: [{ imageClaimedAt: null }, { imageClaimedAt: { lt: staleBefore } }] },
        ],
      },
      data: { imageClaimedAt: claimedAt, updatedAt: meal.updatedAt },
    })
    if (claim.count === 0) {
      result.skipped.push({
        slug: entry.slug,
        reason: 'changed or claimed since the plan was read',
      })
      deps.log(`${entry.slug}  skipped: changed or claimed since the plan was read`)
      continue
    }

    let uploadedUrl: string | null = null
    try {
      const bytes = deps.readFile(join(runDir, entry.file))
      // Re-extracted rather than read from the manifest: the same rule as the
      // route, whatever an older run recorded.
      const imageHue = await hueOf(bytes, entry.slug, deps.log)
      uploadedUrl = await deps.put(meal.id, bytes, entry.mediaType)
      const attached = await deps.db.meal.updateMany({
        where: { id: meal.id, imageClaimedAt: claimedAt, updatedAt: meal.updatedAt },
        data: {
          imageStatus: 'ready',
          imageUrl: uploadedUrl,
          imagePromptVersion: MEAL_IMAGE_PROMPT_VERSION,
          imageHue,
          imageClaimedAt: null,
          imageAttempts: 0,
          updatedAt: meal.updatedAt,
        },
      })
      if (attached.count === 0) {
        await discard(uploadedUrl)
        result.skipped.push({ slug: entry.slug, reason: 'the meal changed during the upload' })
        deps.log(`${entry.slug}  skipped: the meal changed during the upload`)
        continue
      }
      // The image this replaces (an older prompt version) is now unreferenced.
      if (meal.imageUrl && meal.imageUrl !== uploadedUrl) await discard(meal.imageUrl)
      result.published.push(entry.slug)
      deps.log(`${entry.slug}  published`)
    } catch (error) {
      if (uploadedUrl) await discard(uploadedUrl)
      // Release the claim so the next run need not wait out CLAIM_STALE_MS.
      await deps.db.meal
        .updateMany({
          where: { id: meal.id, imageClaimedAt: claimedAt, updatedAt: meal.updatedAt },
          data: { imageClaimedAt: null, updatedAt: meal.updatedAt },
        })
        .catch(() => {})
      result.failed.push({ slug: entry.slug, error: messageOf(error) })
      deps.log(`${entry.slug}  FAILED: ${messageOf(error)}`)
    }
  }
  return result
}

// ============================================
// ENVIRONMENT CHECKS
// ============================================

export function databaseHost(databaseUrl: string | undefined): string {
  if (!databaseUrl) throw new Error('DATABASE_URL is not set')
  try {
    return new URL(databaseUrl).hostname
  } catch {
    throw new Error('DATABASE_URL is not a valid URL')
  }
}

const REFRESH_HINT = `Refresh it from the Vercel environment that matches the database you publish to:
  vercel env pull --environment=<env> /tmp/wobblepot-blob.env
  grep -E '^(VERCEL_OIDC_TOKEN|BLOB_STORE_ID)=' /tmp/wobblepot-blob.env   # copy both lines into .env
  rm /tmp/wobblepot-blob.env
Never run a bare \`vercel env pull\`: it writes .env.local. A static BLOB_READ_WRITE_TOKEN for the store also works.`

/** Seconds since the epoch at which a JWT expires, or `undefined` if it cannot be read. */
function jwtExpiry(token: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
    return typeof payload.exp === 'number' ? payload.exp : undefined
  } catch {
    return undefined
  }
}

/**
 * `@vercel/blob` reads its credentials from the environment (HON-734). Checked
 * before any upload so a day-old OIDC token fails here with instructions,
 * rather than on the first `put` with a bare 403.
 */
export function checkBlobCredentials(env: Env, now: Date): string {
  // Same order as `@vercel/blob`'s `resolveBlobAuth`: OIDC plus a store id wins
  // over a static token, so this must report — and expiry-check — that pair.
  if (env.VERCEL_OIDC_TOKEN && env.BLOB_STORE_ID) {
    const exp = jwtExpiry(env.VERCEL_OIDC_TOKEN)
    // Five minutes of margin: a batch of ~270 uploads takes a few minutes.
    if (exp !== undefined && exp * 1000 < now.getTime() + 5 * 60_000) {
      throw new Error(`VERCEL_OIDC_TOKEN has expired (tokens last about a day).\n${REFRESH_HINT}`)
    }
    return `BLOB_STORE_ID ${env.BLOB_STORE_ID} via VERCEL_OIDC_TOKEN`
  }
  if (env.BLOB_READ_WRITE_TOKEN) return 'BLOB_READ_WRITE_TOKEN'
  throw new Error(
    `Blob needs BLOB_STORE_ID and VERCEL_OIDC_TOKEN (or BLOB_READ_WRITE_TOKEN).\n${REFRESH_HINT}`,
  )
}

/**
 * The operator types the database host back. `--yes=<host>` answers without
 * a prompt, but must still name the host exactly — it is not a blanket skip.
 */
export async function confirmHost(
  host: string,
  opts: { yes?: string; ask: (question: string) => Promise<string> },
): Promise<boolean> {
  const answer = opts.yes ?? (await opts.ask(`Type the database host to publish to it (${host}): `))
  return answer.trim() === host
}

// ============================================
// MAIN
// ============================================

export interface RunDeps extends GenerateDeps {
  db: Db
  put: PublishDeps['put']
  remove: PublishDeps['remove']
  ask: (question: string) => Promise<string>
  env: Env
  now: () => Date
  /** Where `--confirm` creates its timestamped run dir. */
  outRoot: string
}

export async function run(args: ParsedArgs, deps: RunDeps): Promise<void> {
  const { log } = deps

  if (args.help) return log(USAGE)

  if (args.publish) {
    const runDir = resolve(args.publish)
    const manifest = readManifest(runDir)
    const blob = checkBlobCredentials(deps.env, deps.now())
    const host = databaseHost(deps.env.DATABASE_URL)

    const targets = await deps.db.meal.findMany({
      where: { householdId: null, deletedAt: null },
      select: MEAL_SELECT,
    })
    const plan = buildPublishPlan(manifest, targets, args.exclude)
    const toPublish = plan.items.filter((i) => i.action === 'publish')

    for (const item of plan.items) {
      if (item.action === 'skip') log(`skip  ${item.slug}: ${item.reason}`)
    }
    if (plan.unknownExcludes.length > 0) {
      log(`Warning: --exclude names slugs not in this run: ${plan.unknownExcludes.join(', ')}`)
    }
    log(`\nPublish ${toPublish.length} of ${manifest.entries.length} images from ${runDir}`)
    log(`  database: ${host}`)
    log(`  blob:     ${blob}`)
    if (toPublish.length === 0) return log('Nothing to publish.')

    if (!(await confirmHost(host, { yes: args.yes, ask: deps.ask }))) {
      throw new Error('Host not confirmed — nothing was published.')
    }

    const result = await runPublish(plan, runDir, {
      db: deps.db,
      put: deps.put,
      remove: deps.remove,
      readFile: (path) => readFileSync(path),
      now: deps.now,
      log,
    })
    log(
      `\nPublished ${result.published.length}, skipped ${result.skipped.length}, failed ${result.failed.length}.`,
    )
    if (result.failed.length > 0) {
      throw new Error(`${result.failed.length} image(s) failed to publish — rerun to retry them.`)
    }
    return
  }

  const selected = await selectMeals(deps.db, args)
  const allGlobal = await deps.db.meal.findMany({
    where: { householdId: null, deletedAt: null },
    select: { name: true },
  })
  const { unique: meals, ambiguous } = uniqueBySlug(selected, allGlobal)
  if (ambiguous.length > 0) {
    log(
      `Skipping meals whose names share a slug (publish could not tell them apart): ${ambiguous.join(', ')}`,
    )
  }
  const estimate = estimateUsd(meals.length, args.judge)
  log(
    `${meals.length} global meal(s) need an image at prompt ${MEAL_IMAGE_PROMPT_VERSION}${args.judge ? ', with the judge' : ''} — est. $${estimate.toFixed(2)}`,
  )
  for (const meal of meals.slice(0, 10)) log(`  ${slugify(meal.name)}`)
  if (meals.length > 10) log(`  … and ${meals.length - 10} more`)

  if (meals.length === 0) return
  if (!args.confirm) return log(`Dry run — pass --confirm to spend ~$${estimate.toFixed(2)}.`)

  const missing = ['OPENAI_API_KEY', ...(args.judge ? ['ANTHROPIC_API_KEY'] : [])].filter(
    (k) => !deps.env[k],
  )
  if (missing.length > 0) throw new Error(`Missing ${missing.join(', ')} in .env`)

  const startedAt = deps.now().toISOString()
  const outDir = join(deps.outRoot, startedAt.replace(/[:.]/g, '-'))
  const t0 = performance.now()
  const manifest = await runGenerate(
    meals,
    { outDir, judge: args.judge, concurrency: args.concurrency, startedAt },
    deps,
  )
  const elapsedMs = performance.now() - t0
  const failed = manifest.entries.filter((e) => e.error).length
  const generated = manifest.entries.length - failed
  log(
    `\nGenerated ${generated}, failed ${failed}. Spent $${totalUsdOf(manifest).toFixed(2)} (not ledgered).`,
  )
  // At or near the tier's limit, more lanes would only add 429 waits (HON-742).
  log(
    `Rate: ${imagesPerMinute(generated, elapsedMs).toFixed(1)} images/min over ${(elapsedMs / 60_000).toFixed(1)} min (tier limit ${TIER_IMAGES_PER_MINUTE}/min, --concurrency=${args.concurrency}).`,
  )
  log(`Contact sheet: ${pathToFileURL(join(outDir, 'index.html')).href}`)
  log(`Review it, then: pnpm meal-images:global --publish=${outDir} [--exclude=slug,slug]`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  // Lazy: the unit test imports this module and must construct no client.
  const [{ prisma }, { generateMealImage }, { putMealImage, deleteMealImage }] = await Promise.all([
    import('../src/lib/prisma'),
    import('../src/lib/meal-images/generate'),
    import('../src/lib/meal-images/storage'),
  ])
  const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    await run(args, {
      db: prisma,
      generate: generateMealImage,
      put: putMealImage,
      remove: deleteMealImage,
      ask: (question) => rl.question(question),
      env: process.env,
      now: () => new Date(),
      outRoot: join(repoRoot, '.temp', 'global-meal-images'),
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
    console.error(`\ngenerate-global-meal-images failed: ${messageOf(error)}`)
    process.exitCode = 1
  })
}
