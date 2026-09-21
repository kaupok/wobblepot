/**
 * Meal Image Spike (HON-717)
 *
 * Generates 4 meals × 3 styles × 3 models = 36 images and writes a static HTML
 * contact sheet for side-by-side review, plus measured per-image USD and
 * latency per model. Evidence for HON-726 (pick a provider and a style) — no
 * production surface: no schema, no storage, no env schema, no AiUsage ledger.
 *
 * COSTS REAL MONEY (~$2 for the full run). Without `--confirm` it is a dry run:
 * it prints the job matrix and the estimated total, then exits.
 *
 * Needs OPENAI_API_KEY and GOOGLE_GENERATIVE_AI_API_KEY in `.env` (HON-731).
 * They are read straight from process.env on purpose — `src/lib/env.ts` throws
 * on missing required keys, which would break every other surface.
 *
 * Output: .temp/spike-meal-images/<timestamp>/index.html (gitignored)
 *
 * Usage: pnpm spike:meal-images [--confirm] [--models=flare,sunburst,nano-banana-2]
 *                               [--styles=photo,illustration,flat]
 */

import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import { generateImage, type ImageModel, type ImageModelUsage } from 'ai'

// ============================================
// MEALS
// ============================================

export interface SpikeMeal {
  slug: string
  name: string
  description: string
  ingredients: string[]
}

export const MEALS: SpikeMeal[] = [
  // Photogenic classic (prisma/seed.ts — Spaghetti Bolognese)
  {
    slug: 'bolognese',
    name: 'Spaghetti Bolognese',
    description: 'Classic Italian meat sauce with spaghetti',
    ingredients: [
      'ground beef',
      'spaghetti',
      'tomato sauce',
      'onion',
      'carrot',
      'garlic',
      'parmesan',
    ],
  },
  // Brown stew — the case AI food models handle worst (prisma/seed.ts — Navy Bean Stew)
  {
    slug: 'bean-stew',
    name: 'Navy Bean Stew',
    description: 'Hearty white bean stew with vegetables',
    ingredients: ['navy beans', 'tomato', 'carrot', 'celery', 'onion', 'rosemary', 'olive oil'],
  },
  // Salad (prisma/seed.ts — Greek Salad with Feta)
  {
    slug: 'greek-salad',
    name: 'Greek Salad with Feta',
    description: 'Fresh salad with tomatoes, cucumber, and feta cheese',
    ingredients: ['feta cheese', 'tomato', 'cucumber', 'onion', 'olive oil'],
  },
  // Deliberately odd, "Imagine a meal"-style dish: exists nowhere else, so
  // the model cannot lean on a memorised reference photo.
  {
    slug: 'beetroot-gratin',
    name: 'Miso-glazed Beetroot & Rhubarb Gratin',
    description:
      'Layered beetroot and rhubarb baked under a white miso cream, finished with toasted buckwheat',
    ingredients: ['beetroot', 'rhubarb', 'white miso', 'heavy cream', 'buckwheat', 'thyme'],
  },
]

// ============================================
// STYLES
// ============================================

export type StyleId = 'photo' | 'illustration' | 'flat'

export interface SpikeStyle {
  id: StyleId
  label: string
  /** Swappable, versioned prompt prefix — the follow-up reuses whichever wins. */
  prefix: string
}

export const STYLE_PREFIX_PHOTO_V1 =
  'Overhead food photograph, natural window light, shallow depth of field, served on a simple ceramic plate on a wooden table. Realistic, appetising home cooking, not restaurant plating.'
export const STYLE_PREFIX_ILLUSTRATION_V1 =
  'Warm stylised illustration of a home-cooked dish, soft gouache textures, gentle hand-drawn linework, muted natural palette, seen from a three-quarter angle.'
export const STYLE_PREFIX_FLAT_V1 =
  'Flat vector illustration of a dish, simple geometric shapes, limited palette of four to five colours, no gradients, no shadows, centred on a plain light background.'

export const STYLES: SpikeStyle[] = [
  { id: 'photo', label: 'Photoreal overhead', prefix: STYLE_PREFIX_PHOTO_V1 },
  { id: 'illustration', label: 'Stylised illustration', prefix: STYLE_PREFIX_ILLUSTRATION_V1 },
  { id: 'flat', label: 'Flat / iconographic', prefix: STYLE_PREFIX_FLAT_V1 },
]

const PROMPT_SUFFIX =
  'A single dish, landscape 3:2 composition with the food filling the frame. No text, no labels, no logos, no hands, no people.'

// ============================================
// MODELS
// ============================================

export type ModelKey = 'flare' | 'sunburst' | 'nano-banana-2'

/** USD per 1M tokens. */
export interface TokenRate {
  inputPerM: number
  outputPerM: number
}

type ImageCallOptions = Pick<
  Parameters<typeof generateImage>[0],
  'size' | 'aspectRatio' | 'providerOptions'
>

export interface SpikeModel {
  key: ModelKey
  label: string
  modelId: string
  /** Lazy, so a dry run never constructs a provider or touches a key. */
  model: () => ImageModel
  callOptions: ImageCallOptions
  rate: TokenRate
  /** Flat fallback when the result carries no token usage. */
  estPerImageUsd: number
  apiKeyEnv: 'OPENAI_API_KEY' | 'GOOGLE_GENERATIVE_AI_API_KEY'
}

// Rates checked 2026-09-21:
// OpenAI — https://developers.openai.com/api/docs/pricing (GPT Image 2.5: text in $5, image out $30 per 1M)
// Google — https://ai.google.dev/gemini-api/docs/pricing (3.1 Flash Image: in $0.50, image out $60 per 1M; 1K ≈ 1120 tokens ≈ $0.067)
const OPENAI_IMAGE_RATE: TokenRate = { inputPerM: 5, outputPerM: 30 }
const OPENAI_CALL_OPTIONS: ImageCallOptions = {
  size: '1536x1024',
  // `max` costs ~4× and a dialog hero won't show the difference (research comment on HON-717).
  providerOptions: { openai: { quality: 'high', outputFormat: 'png' } },
}

export const MODELS: SpikeModel[] = [
  {
    key: 'flare',
    label: 'GPT Image 2.5 Flare (high)',
    modelId: 'gpt-image-2.5-flare',
    model: () => openai.image('gpt-image-2.5-flare'),
    callOptions: OPENAI_CALL_OPTIONS,
    rate: OPENAI_IMAGE_RATE,
    estPerImageUsd: 0.05,
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  {
    key: 'sunburst',
    label: 'GPT Image 2.5 Sunburst (high)',
    modelId: 'gpt-image-2.5-sunburst',
    model: () => openai.image('gpt-image-2.5-sunburst'),
    callOptions: OPENAI_CALL_OPTIONS,
    rate: OPENAI_IMAGE_RATE,
    estPerImageUsd: 0.05,
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  {
    key: 'nano-banana-2',
    label: 'Gemini 3.1 Flash Image (1K)',
    modelId: 'gemini-3.1-flash-image',
    model: () => google.image('gemini-3.1-flash-image'),
    callOptions: {
      aspectRatio: '3:2',
      providerOptions: { google: { imageConfig: { imageSize: '1K' } } },
    },
    rate: { inputPerM: 0.5, outputPerM: 60 },
    estPerImageUsd: 0.067,
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
]

// ============================================
// PURE HELPERS
// ============================================

export interface Job {
  model: SpikeModel
  meal: SpikeMeal
  style: SpikeStyle
}

export interface JobResult {
  modelKey: ModelKey
  mealSlug: string
  styleId: StyleId
  prompt: string
  latencyMs: number
  /** Relative to the run dir; absent when generation failed. */
  file?: string
  usd?: number
  costMeasured?: boolean
  usage?: { inputTokens?: number; outputTokens?: number }
  warnings?: string[]
  /** Raw provider metadata — Gemini's per-modality token breakdown lives here. */
  providerMetadata?: unknown
  error?: string
}

export interface ParsedArgs {
  confirm: boolean
  models: ModelKey[]
  styles: StyleId[]
}

export function buildPrompt(meal: SpikeMeal, style: SpikeStyle): string {
  return [
    style.prefix,
    `The dish: ${meal.name} — ${meal.description}.`,
    `Key ingredients: ${meal.ingredients.join(', ')}.`,
    PROMPT_SUFFIX,
  ].join(' ')
}

export function parseArgs(argv: string[]): ParsedArgs {
  const list = (flag: string): string[] | undefined => {
    const arg = argv.find((a) => a.startsWith(`--${flag}=`))
    return arg
      ?.slice(flag.length + 3)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  const allModels = MODELS.map((m) => m.key)
  const allStyles = STYLES.map((s) => s.id)
  const models = list('models') ?? allModels
  const styles = list('styles') ?? allStyles
  const badModel = models.find((m) => !allModels.includes(m as ModelKey))
  if (badModel) throw new Error(`Unknown model "${badModel}". Known: ${allModels.join(', ')}`)
  const badStyle = styles.find((s) => !allStyles.includes(s as StyleId))
  if (badStyle) throw new Error(`Unknown style "${badStyle}". Known: ${allStyles.join(', ')}`)
  return {
    confirm: argv.includes('--confirm'),
    models: models as ModelKey[],
    styles: styles as StyleId[],
  }
}

export function buildJobs(args: Pick<ParsedArgs, 'models' | 'styles'>): Job[] {
  const jobs: Job[] = []
  for (const model of MODELS.filter((m) => args.models.includes(m.key))) {
    for (const meal of MEALS) {
      for (const style of STYLES.filter((s) => args.styles.includes(s.id))) {
        jobs.push({ model, meal, style })
      }
    }
  }
  return jobs
}

export function estimateTotalUsd(jobs: Job[]): number {
  return jobs.reduce((sum, job) => sum + job.model.estPerImageUsd, 0)
}

export function costFromUsage(
  usage: Partial<ImageModelUsage> | undefined,
  rate: TokenRate,
  estPerImageUsd: number,
): { usd: number; measured: boolean } {
  if (usage?.outputTokens == null) return { usd: estPerImageUsd, measured: false }
  const usd =
    ((usage.inputTokens ?? 0) * rate.inputPerM + usage.outputTokens * rate.outputPerM) / 1_000_000
  return { usd, measured: true }
}

export interface ModelSummary {
  model: ModelKey
  ok: number
  failed: number
  meanLatencyS: number
  minLatencyS: number
  maxLatencyS: number
  meanUsd: number
  totalUsd: number
  cost: 'measured' | 'est.' | 'mixed' | 'n/a'
}

export function summarize(results: JobResult[]): ModelSummary[] {
  const keys = [...new Set(results.map((r) => r.modelKey))]
  const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp
  return keys.map((key) => {
    const all = results.filter((r) => r.modelKey === key)
    const ok = all.filter((r) => !r.error)
    const latencies = ok.map((r) => r.latencyMs / 1000)
    const usds = ok.map((r) => r.usd ?? 0)
    const total = usds.reduce((a, b) => a + b, 0)
    const measured = ok.filter((r) => r.costMeasured).length
    return {
      model: key,
      ok: ok.length,
      failed: all.length - ok.length,
      meanLatencyS: ok.length ? round(latencies.reduce((a, b) => a + b, 0) / ok.length, 1) : 0,
      minLatencyS: ok.length ? round(Math.min(...latencies), 1) : 0,
      maxLatencyS: ok.length ? round(Math.max(...latencies), 1) : 0,
      meanUsd: ok.length ? round(total / ok.length, 4) : 0,
      totalUsd: round(total, 4),
      cost:
        ok.length === 0
          ? 'n/a'
          : measured === ok.length
            ? 'measured'
            : measured === 0
              ? 'est.'
              : 'mixed',
    }
  })
}

export function extensionFor(mediaType: string): string {
  const sub = mediaType.split('/')[1] ?? 'bin'
  return sub === 'jpeg' ? 'jpg' : sub
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderContactSheet(
  results: JobResult[],
  meta: { startedAt: string; models: SpikeModel[]; styles: SpikeStyle[] },
): string {
  const cell = (r: JobResult | undefined): string => {
    if (!r) return '<td class="empty">—</td>'
    if (r.error) return `<td class="failed"><strong>Failed</strong><br>${escapeHtml(r.error)}</td>`
    const cost = r.usd == null ? '' : `$${r.usd.toFixed(3)}${r.costMeasured ? '' : ' est.'}`
    return `<td><a href="${escapeHtml(r.file ?? '')}"><img src="${escapeHtml(r.file ?? '')}" alt="${escapeHtml(`${r.mealSlug} — ${r.styleId}`)}" loading="lazy"></a><div class="meta">${(r.latencyMs / 1000).toFixed(1)}s · ${cost}</div></td>`
  }

  const sections = meta.models
    .map((model) => {
      const rows = MEALS.map((meal) => {
        const cells = meta.styles
          .map((style) =>
            cell(
              results.find(
                (r) =>
                  r.modelKey === model.key && r.mealSlug === meal.slug && r.styleId === style.id,
              ),
            ),
          )
          .join('')
        return `<tr><th scope="row">${escapeHtml(meal.name)}</th>${cells}</tr>`
      }).join('\n')
      const head = meta.styles.map((s) => `<th scope="col">${escapeHtml(s.label)}</th>`).join('')
      return `<section>
<h2>${escapeHtml(model.label)} <code>${escapeHtml(model.modelId)}</code></h2>
<table><thead><tr><th></th>${head}</tr></thead><tbody>
${rows}
</tbody></table>
</section>`
    })
    .join('\n')

  const summaryRows = summarize(results)
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.model)}</td><td>${s.ok}</td><td>${s.failed}</td><td>${s.meanLatencyS}s (${s.minLatencyS}–${s.maxLatencyS})</td><td>$${s.meanUsd.toFixed(4)}</td><td>$${s.totalUsd.toFixed(4)}</td><td>${s.cost}</td></tr>`,
    )
    .join('\n')

  const prompts = meta.styles
    .map((s) => `<li><strong>${escapeHtml(s.label)}:</strong> ${escapeHtml(s.prefix)}</li>`)
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meal image spike — ${escapeHtml(meta.startedAt)}</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 24px; color: #1c1917; background: #fafaf9; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 32px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #d6d3d1; padding: 6px; vertical-align: top; text-align: left; }
  td img { width: 360px; height: auto; display: block; }
  .meta { color: #57534e; font-size: 12px; margin-top: 4px; }
  .failed { width: 360px; color: #b91c1c; font-size: 12px; }
  .summary td, .summary th { padding: 4px 10px; }
</style>
</head>
<body>
<h1>Meal image spike (HON-717) — ${escapeHtml(meta.startedAt)}</h1>
<table class="summary"><thead><tr><th>Model</th><th>OK</th><th>Failed</th><th>Latency mean (min–max)</th><th>Mean USD</th><th>Total USD</th><th>Cost</th></tr></thead><tbody>
${summaryRows}
</tbody></table>
<h2>Style prefixes</h2>
<ul>${prompts}</ul>
<p class="meta">Every prompt = style prefix + meal name/description + key ingredients + “${escapeHtml(PROMPT_SUFFIX)}”. Full prompts in results.json.</p>
${sections}
</body>
</html>
`
}

// ============================================
// MAIN
// ============================================

function isOrgVerificationError(error: unknown): boolean {
  const parts: string[] = []
  if (error instanceof Error) parts.push(error.message)
  if (error && typeof error === 'object' && 'responseBody' in error) {
    parts.push(String((error as { responseBody?: unknown }).responseBody ?? ''))
  }
  return /organization must be verified/i.test(parts.join(' '))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const jobs = buildJobs(args)
  const models = MODELS.filter((m) => args.models.includes(m.key))
  const styles = STYLES.filter((s) => args.styles.includes(s.id))

  console.log(`\nMeal image spike — ${jobs.length} images`)
  console.log(`  Meals:  ${MEALS.map((m) => m.name).join(', ')}`)
  console.log(`  Styles: ${styles.map((s) => s.label).join(', ')}`)
  for (const m of models) {
    const n = jobs.filter((j) => j.model.key === m.key).length
    console.log(
      `  ${m.label.padEnd(32)} ${n} × ~$${m.estPerImageUsd.toFixed(3)} = ~$${(n * m.estPerImageUsd).toFixed(2)}`,
    )
  }
  const estimate = estimateTotalUsd(jobs)
  console.log(`  Estimated total: ~$${estimate.toFixed(2)}\n`)

  if (!args.confirm) {
    console.log(`Dry run — pass --confirm to spend ~$${estimate.toFixed(2)}.`)
    return
  }

  const missing = [...new Set(models.map((m) => m.apiKeyEnv))].filter((k) => !process.env[k])
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(', ')} in .env (see HON-731).`)
  }

  const startedAt = new Date().toISOString()
  const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const outDir = join(repoRoot, '.temp', 'spike-meal-images', startedAt.replace(/[:.]/g, '-'))
  for (const m of models) mkdirSync(join(outDir, m.key), { recursive: true })

  const results: JobResult[] = []
  for (const [i, job] of jobs.entries()) {
    const prompt = buildPrompt(job.meal, job.style)
    const base = { modelKey: job.model.key, mealSlug: job.meal.slug, styleId: job.style.id, prompt }
    const tag = `[${String(i + 1).padStart(2)}/${jobs.length}] ${job.model.key} · ${job.meal.slug} · ${job.style.id}`
    const t0 = performance.now()
    try {
      const result = await generateImage({
        model: job.model.model(),
        prompt,
        ...job.model.callOptions,
        maxRetries: 1,
      })
      const latencyMs = performance.now() - t0
      // Gemini returns JPEG even though OpenAI honours outputFormat: 'png'.
      const file = `${job.model.key}/${job.meal.slug}-${job.style.id}.${extensionFor(result.image.mediaType)}`
      writeFileSync(join(outDir, file), result.image.uint8Array)
      const cost = costFromUsage(result.usage, job.model.rate, job.model.estPerImageUsd)
      const warnings = result.warnings.map((w) => JSON.stringify(w))
      results.push({
        ...base,
        latencyMs,
        file,
        usd: cost.usd,
        costMeasured: cost.measured,
        usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
        warnings,
        providerMetadata: result.providerMetadata,
      })
      console.log(
        `${tag}  ${(latencyMs / 1000).toFixed(1)}s  $${cost.usd.toFixed(4)}${cost.measured ? '' : ' est.'}  ${result.image.mediaType}${warnings.length ? `  warnings: ${warnings.join('; ')}` : ''}`,
      )
    } catch (error) {
      const latencyMs = performance.now() - t0
      if (isOrgVerificationError(error)) {
        throw new Error(
          'OpenAI returned 403 "Organization must be verified" — a console fix, not a code bug. Verify the org (see HON-731) and rerun.',
        )
      }
      const message = error instanceof Error ? error.message : String(error)
      results.push({ ...base, latencyMs, error: message })
      console.log(`${tag}  FAILED after ${(latencyMs / 1000).toFixed(1)}s: ${message}`)
    }
  }

  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ startedAt, results }, null, 2))
  const sheet = join(outDir, 'index.html')
  writeFileSync(sheet, renderContactSheet(results, { startedAt, models, styles }))

  console.log('\nPer-model summary:')
  console.table(summarize(results))
  console.log(`\nContact sheet: ${pathToFileURL(sheet).href}`)
}

// Guarded so the unit test can import the pure helpers without spending money.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(
      `\nspike-meal-images failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  })
}
