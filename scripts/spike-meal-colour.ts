/**
 * Meal Colour Spike (HON-743)
 *
 * Which hue is "the meal's colour", and how does an opaque illustration fade
 * into a card tinted with it? The naive dominant colour of a plated dish is
 * the plate or the table, so the rule crops to the centre, drops grey pixels
 * below a chroma floor, and takes the chroma-weighted winner of 18 hue bins.
 *
 * Input is a HON-738 run directory (the images as shipped). Output is a
 * contact sheet with the extracted hue, mock cards in light and dark, a modal
 * hero, and sliders for the few numbers that are meant to be tuned once for
 * every meal (lightness, chroma, fade). No spend, no database, no Blob, no
 * product code.
 *
 * A `background: 'transparent'` redraw was tried first (2026-09-22, $0.60) and
 * rejected: the V3 prompt's tabletop survives as a halo and the shadows look
 * wrong once isolated. The illustrations stay opaque. A CSS scale-and-vignette
 * was rejected next: the space has to be in the image. So `--draw` redraws a
 * few meals with candidate V4 composition lines (see PROMPT_VARIANTS) next to
 * the shipped image, at ~$0.05 each. Needs OPENAI_API_KEY in `.env`, read from
 * process.env on purpose (see spike-meal-images.ts); one draw at a time, which
 * stays under the org's five images a minute.
 *
 * Usage: pnpm spike:meal-colour [--source=<run dir>] [--limit=N]
 *        pnpm spike:meal-colour --draw=v4,v4-fade [--meals=slug,slug] [--limit=N] [--confirm]
 *
 * Output: .temp/spike-meal-colour/<timestamp>/index.html (gitignored)
 */

import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createOpenAI } from '@ai-sdk/openai'
import { generateImage } from 'ai'
import sharp from 'sharp'
import {
  DEFAULT_HUE_OPTIONS,
  extractHue,
  srgbToOklch,
  type HueOptions,
  type HueResult,
  type Oklch,
} from '../src/lib/meal-images/colour'
import { PROMPT_SUFFIX } from '../src/lib/meal-images/prompt'
import { V3_PROMPT_SUFFIX } from './spike-meal-images'

const DEFAULT_SOURCE = '.temp/global-meal-images/2026-09-22T07-01-28-144Z'
const PREVIEW_WIDTH = 768
const MODEL = 'gpt-image-2.5-flare'
const EST_PER_IMAGE_USD = 0.05

/**
 * Candidate replacements for the V3 suffix's composition clause ("with the
 * food filling the frame"). Each variant is the shipped prompt with the
 * suffix swapped, so the only thing that changes is the framing.
 */
export const PROMPT_VARIANTS: Record<string, string> = {
  v4: 'A single dish, landscape 3:2 composition. The plate sits in the centre and takes up about half the width of the frame, with generous empty surface around it on every side. No text, no labels, no logos, no hands, no people.',
  'v4-fade':
    'A single dish, landscape 3:2 composition. The plate sits in the centre and takes up about half the width of the frame, with generous empty surface around it on every side; the surface is plain and even and fades softly towards the edges of the frame. No text, no labels, no logos, no hands, no people.',
  // A white surface disappears under `mix-blend-mode: multiply` on any card tint,
  // so the meal hue comes from the food alone and the fade has nothing to clash with.
  'v4-white':
    'A single dish, landscape 3:2 composition. The plate sits in the centre and takes up about half the width of the frame, with generous empty space around it on every side. The surface is pure white, flat and untextured, with only a soft light shadow under the plate. No text, no labels, no logos, no hands, no people.',
}

export function variantPrompt(shipped: string, variant: string): string {
  const suffix = PROMPT_VARIANTS[variant]
  if (!suffix) throw new Error(`Unknown prompt variant: ${variant}`)
  // V4 shipped `v4-white` as `PROMPT_SUFFIX` (HON-744); the HON-738 runs were
  // drawn at V3, so a run dir holds prompts ending in either.
  const current = [PROMPT_SUFFIX, V3_PROMPT_SUFFIX].find((s) => shipped.endsWith(s))
  if (!current) throw new Error('Shipped prompt does not end with a known suffix')
  return shipped.slice(0, -current.length) + suffix
}

// ============================================
// INPUT
// ============================================

interface ManifestEntry {
  slug: string
  name: string
  prompt: string
  file: string
}

interface Manifest {
  promptVersion: string
  entries: ManifestEntry[]
}

export interface ParsedArgs {
  source: string
  limit?: number
  meals?: string[]
  draw: string[]
  confirm: boolean
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { source: DEFAULT_SOURCE, draw: [], confirm: false }
  for (const arg of argv) {
    if (arg.startsWith('--source=')) args.source = arg.slice('--source='.length)
    else if (arg === '--confirm') args.confirm = true
    else if (arg.startsWith('--meals='))
      args.meals = arg.slice('--meals='.length).split(',').filter(Boolean)
    else if (arg.startsWith('--draw=')) {
      args.draw = arg.slice('--draw='.length).split(',').filter(Boolean)
      for (const v of args.draw)
        if (!PROMPT_VARIANTS[v]) throw new Error(`Unknown prompt variant: ${v}`)
    } else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length))
      if (!Number.isInteger(n) || n < 1)
        throw new Error(`--limit must be a positive integer, got ${arg}`)
      args.limit = n
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  return args
}

function readManifest(dir: string): Manifest {
  const file = join(dir, 'manifest.json')
  if (!existsSync(file)) throw new Error(`No manifest.json in ${dir}`)
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Manifest
  // Only meals that were actually drawn: a rate-limited entry has no file.
  manifest.entries = manifest.entries.filter((e) => e.file && existsSync(join(dir, e.file)))
  return manifest
}

// ============================================
// COLOUR
// ============================================

/** Mean OKLCH of the outer 10% frame: the painted surface the image sits on. */
export async function extractSurface(file: string): Promise<Oklch> {
  const { data, info } = await sharp(file)
    .resize(64, 64, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let L = 0
  let a = 0
  let b = 0
  let n = 0
  const edge = Math.round(info.width * 0.1)
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (x >= edge && x < info.width - edge && y >= edge && y < info.height - edge) continue
      const o = (y * info.width + x) * info.channels
      const c = srgbToOklch(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0)
      const rad = (c.h * Math.PI) / 180
      L += c.L
      a += Math.cos(rad) * c.C
      b += Math.sin(rad) * c.C
      n++
    }
  }
  L /= n
  a /= n
  b /= n
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }
}

// ============================================
// CONTACT SHEET
// ============================================

export interface SheetImage {
  /** `shipped` for the HON-741 image, otherwise the PROMPT_VARIANTS key. */
  label: string
  preview: string
  hue: HueResult
  /** The painted surface at the image edge; a card can take its colour from it. */
  surface?: Oklch
}

export interface SheetRow {
  slug: string
  name: string
  images: SheetImage[]
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const fmt = (n: number, digits = 2) => n.toFixed(digits)

function styleVars(image: SheetImage) {
  const hue = image.hue.hue ?? 0
  const sf = image.surface
  return `--hue:${hue}${sf ? `;--sf-l:${fmt(sf.L, 3)};--sf-c:${fmt(sf.C, 3)};--sf-h:${Math.round(sf.h)}` : ''}`
}

function card(row: SheetRow, image: SheetImage, theme: 'light' | 'dark') {
  const hue = image.hue.hue ?? 0
  return `<div class="card ${theme}" style="${styleVars(image)}" title="${image.label}, ${theme}, hue ${hue}">
      <img src="${image.preview}" alt="">
      <div class="text"><div class="title">${escape(row.name)}</div><div class="meta">35 min · 4 servings</div><span class="chip">Dinner</span></div>
    </div>`
}

function hero(row: SheetRow, image: SheetImage, theme: 'light' | 'dark') {
  return `<div class="hero ${theme}" style="${styleVars(image)}">
      <img src="${image.preview}" alt="">
      <div class="text"><div class="title">${escape(row.name)}</div><div class="meta">${image.label} · ${theme}</div></div>
    </div>`
}

function histogram(r: HueResult) {
  const max = Math.max(...r.bins, 1e-9)
  const n = r.bins.length
  return `<div class="hist">${r.bins
    .map((v, i) => {
      const h = Math.round(((i + 0.5) * 360) / n)
      return `<i style="height:${Math.max(2, (v / max) * 100)}%;background:oklch(0.7 0.15 ${h})"></i>`
    })
    .join('')}</div>`
}

function hueLine(label: string, r: HueResult) {
  const sw = r.hue == null ? '' : `<b style="background:oklch(0.75 0.14 ${r.hue})"></b>`
  return `<div class="hue">${sw}<span>${label}</span> ${
    r.hue == null ? '<em>no hue</em>' : `<strong>${r.hue}°</strong>`
  } · C ${fmt(r.chroma, 3)} · voted ${Math.round(r.coverage * 100)}% · opaque ${Math.round(r.opaque * 100)}%${histogram(r)}</div>`
}

export function renderContactSheet(
  rows: SheetRow[],
  meta: { startedAt: string; options: HueOptions },
) {
  const labels = [...new Set(rows.flatMap((r) => r.images.map((i) => i.label)))]
  const grid = (label: string, theme: 'light' | 'dark') =>
    `<section class="grid-section ${theme}"><h3>${label} · ${theme}</h3><div class="grid">${rows
      .flatMap((r) => r.images.filter((i) => i.label === label).map((i) => card(r, i, theme)))
      .join('')}</div></section>`
  const grids = labels.map((l) => grid(l, 'light') + grid(l, 'dark')).join('')
  const body = rows
    .map(
      (r) => `<section class="meal">
      <h2>${escape(r.name)} <code>${r.slug}</code></h2>
      <div class="hues">${r.images
        .map(
          (i) =>
            hueLine(i.label, i.hue) +
            (i.surface
              ? `<div class="hue"><b style="background:oklch(${fmt(i.surface.L, 3)} ${fmt(i.surface.C, 3)} ${Math.round(i.surface.h)})"></b><span>surface</span> L ${fmt(i.surface.L)} C ${fmt(i.surface.C, 3)} h ${Math.round(i.surface.h)}°</div>`
              : ''),
        )
        .join('')}</div>
      <div class="previews">${r.images.map((i) => `<figure><img src="${i.preview}" alt=""><figcaption>${i.label}</figcaption></figure>`).join('')}</div>
      <div class="cards">${r.images.map((i) => card(r, i, 'light') + card(r, i, 'dark')).join('')}</div>
      <div class="heroes">${r.images.map((i) => hero(r, i, 'light') + hero(r, i, 'dark')).join('')}</div>
    </section>`,
    )
    .join('\n')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Meal colour spike (HON-743)</title>
<style>
  :root {
    --l-light: 0.95; --c-light: 0.035;
    --l-dark: 0.26; --c-dark: 0.04;
    --fade: 0.55; --accent-c: 0.12; --img-w: 62; --blend: normal;
    font-family: system-ui, sans-serif; color: #222; background: #f4f4f2;
  }
  body { margin: 0; padding: 24px; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin: 32px 0 8px; } h3 { font-size: 13px; margin: 24px 0 8px; opacity: .7 }
  code { font-size: 12px; opacity: .6; font-weight: normal }
  .controls { position: sticky; top: 0; z-index: 2; background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; display: flex; gap: 20px; flex-wrap: wrap; font-size: 12px; }
  .controls label { display: flex; flex-direction: column; gap: 2px; min-width: 120px }
  .controls output { font-variant-numeric: tabular-nums }
  .meal { border-top: 1px solid #ddd; padding-top: 8px }
  .hues { display: flex; gap: 24px; flex-wrap: wrap; font-size: 12px; margin-bottom: 8px }
  .hue { display: flex; align-items: center; gap: 6px }
  .hue b { width: 18px; height: 18px; border-radius: 50%; display: inline-block; border: 1px solid rgba(0,0,0,.15) }
  .hist { display: inline-flex; align-items: flex-end; gap: 1px; height: 18px; margin-left: 8px }
  .hist i { display: block; width: 4px; border-radius: 1px }
  .previews { display: flex; gap: 12px; margin-bottom: 12px }
  .previews figure { margin: 0; width: 300px } .previews img { width: 300px; aspect-ratio: 3/2; object-fit: cover; border-radius: 6px; display: block }
  figcaption { font-size: 11px; opacity: .6; margin-top: 4px }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px }
  .heroes { display: flex; gap: 12px; flex-wrap: wrap }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px }
  .grid-section { padding: 16px; border-radius: 12px; margin-top: 8px }
  .grid-section.dark { background: oklch(0.18 0 0) } .grid-section.dark h3 { color: #ddd }
  .grid-section.light { background: oklch(0.99 0 0) }

  .card { position: relative; width: 300px; height: 168px; border-radius: 10px; overflow: hidden; isolation: isolate; }
  .grid .card { width: auto }
  .card.light { background: oklch(var(--l-light) var(--c-light) var(--hue)); color: oklch(0.25 0.03 var(--hue)) }
  /* "surface" mode: the light card takes the image's own edge colour, so the fade is seamless. */
  body.surface .card.light, body.surface .hero.light { background: oklch(var(--sf-l, var(--l-light)) var(--sf-c, var(--c-light)) var(--sf-h, var(--hue))) }
  .card img, .hero img { mix-blend-mode: var(--blend) }
  .card.dark  { background: oklch(var(--l-dark)  var(--c-dark)  var(--hue)); color: oklch(0.95 0.02 var(--hue)) }
  .card img { position: absolute; top: 0; right: 0; height: 100%; width: calc(var(--img-w) * 1%); display: block; object-fit: cover;
    mask-image: linear-gradient(to right, transparent 0%, #000 calc(var(--fade) * 100%));
    -webkit-mask-image: linear-gradient(to right, transparent 0%, #000 calc(var(--fade) * 100%)); }
  .card .text { position: absolute; left: 16px; bottom: 14px; right: 40% }
  .card .title { font-weight: 600; font-size: 16px; line-height: 1.2 }
  .card .meta { font-size: 12px; opacity: .75; margin-top: 2px }
  .card .chip { display: inline-block; margin-top: 8px; font-size: 11px; padding: 2px 8px; border-radius: 999px; }
  .card.light .chip { background: oklch(0.86 var(--accent-c) var(--hue)); color: oklch(0.3 0.08 var(--hue)) }
  .card.dark  .chip { background: oklch(0.4 var(--accent-c) var(--hue)); color: oklch(0.95 0.03 var(--hue)) }

  .hero { position: relative; width: 416px; aspect-ratio: 3/2; border-radius: 10px; overflow: hidden }
  .hero.light { background: oklch(var(--l-light) var(--c-light) var(--hue)); color: oklch(0.25 0.03 var(--hue)) }
  .hero.dark  { background: oklch(var(--l-dark)  var(--c-dark)  var(--hue)); color: oklch(0.95 0.02 var(--hue)) }
  .hero img { width: 100%; height: 100%; object-fit: cover; display: block;
    mask-image: linear-gradient(to top, transparent 0%, #000 calc(var(--fade) * 60%));
    -webkit-mask-image: linear-gradient(to top, transparent 0%, #000 calc(var(--fade) * 60%)); }
  .hero .text { position: absolute; left: 20px; bottom: 16px }
  .hero .title { font-weight: 600; font-size: 20px } .hero .meta { font-size: 12px; opacity: .7 }
</style></head>
<body>
<h1>Meal colour spike (HON-743) <code>${meta.startedAt}</code></h1>
<p style="font-size:12px;max-width:80ch">Opaque illustrations as shipped, faded into a card tinted with their hue. Hue rule: centre crop ${meta.options.cropFraction}, ${meta.options.size}×${meta.options.size} sample, chroma floor ${meta.options.chromaFloor}, ${meta.options.bins} bins, chroma-weighted vote, circular mean of the winner. Only hue varies per meal; the sliders are the tokens that would be fixed for all meals.</p>
<form class="controls" oninput="apply()">
  <label>light L <input type="range" min="0.85" max="0.99" step="0.005" name="l-light" value="0.95"><output></output></label>
  <label>light C <input type="range" min="0" max="0.12" step="0.005" name="c-light" value="0.035"><output></output></label>
  <label>dark L <input type="range" min="0.15" max="0.45" step="0.005" name="l-dark" value="0.26"><output></output></label>
  <label>dark C <input type="range" min="0" max="0.12" step="0.005" name="c-dark" value="0.04"><output></output></label>
  <label>fade <input type="range" min="0.1" max="1" step="0.05" name="fade" value="0.55"><output></output></label>
  <label>image width % <input type="range" min="40" max="100" step="2" name="img-w" value="62"><output></output></label>
  <label>accent C <input type="range" min="0" max="0.2" step="0.01" name="accent-c" value="0.12"><output></output></label>
  <label>blend <select name="blend"><option>normal</option><option>multiply</option><option>darken</option><option>luminosity</option><option>hard-light</option><option>soft-light</option></select><output></output></label>
  <label>light card colour <select name="card-colour"><option value="">hue token</option><option value="surface">image surface</option></select><output></output></label>
  <pre id="tokens" style="margin:0;font-size:11px;align-self:center"></pre>
</form>
<script>
  function apply() {
    const root = document.documentElement.style, out = []
    for (const el of document.querySelectorAll('.controls input, .controls select')) {
      if (el.name === 'card-colour') document.body.classList.toggle('surface', el.value === 'surface')
      else root.setProperty('--' + el.name, el.value)
      el.nextElementSibling.value = el.value; out.push(el.name + '=' + el.value)
    }
    document.getElementById('tokens').textContent = out.join('  ')
  }
  apply()
</script>
<h2>All meals together</h2>
${grids}
${body}
</body></html>`
}

// ============================================
// MAIN
// ============================================

async function preview(src: string, dest: string) {
  await sharp(src).resize({ width: PREVIEW_WIDTH }).webp({ quality: 82 }).toFile(dest)
}

async function drawVariant(prompt: string, apiKey: string): Promise<Uint8Array> {
  const openai = createOpenAI({ apiKey })
  const result = await generateImage({
    model: openai.image(MODEL),
    prompt,
    size: '1536x1024',
    providerOptions: { openai: { quality: 'high', outputFormat: 'png' } },
    maxRetries: 2,
  })
  return result.image.uint8Array
}

async function addImage(row: SheetRow, label: string, src: string, outDir: string) {
  const previewFile = `preview/${row.slug}-${label}.webp`
  await preview(src, join(outDir, previewFile))
  const hue = await extractHue(readFileSync(src))
  const surface = await extractSurface(src)
  row.images.push({ label, preview: previewFile, hue, surface })
  console.log(
    `${row.slug.padEnd(32)} ${label.padEnd(8)} ${String(hue.hue ?? '-').padStart(4)}°  C ${hue.chroma.toFixed(3)}  voted ${Math.round(hue.coverage * 100)}%`,
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const source = resolve(args.source)
  const manifest = readManifest(source)
  let entries = args.meals
    ? manifest.entries.filter((e) => args.meals?.includes(e.slug))
    : manifest.entries
  if (args.limit) entries = entries.slice(0, args.limit)
  console.log(`${entries.length} meal(s) from ${source} (prompt ${manifest.promptVersion})`)

  if (args.draw.length) {
    const n = entries.length * args.draw.length
    console.log(
      `Redraw ${args.draw.join(', ')}: ${n} image(s), ~$${(n * EST_PER_IMAGE_USD).toFixed(2)}`,
    )
    if (!args.confirm) {
      console.log('Dry run — pass --confirm to spend.')
      return
    }
  }
  const apiKey = process.env.OPENAI_API_KEY
  if (args.draw.length && !apiKey) throw new Error('OPENAI_API_KEY is not set')

  const startedAt = new Date().toISOString()
  const outDir = resolve('.temp/spike-meal-colour', startedAt.replace(/[:.]/g, '-'))
  mkdirSync(join(outDir, 'preview'), { recursive: true })

  const rows: SheetRow[] = []
  for (const entry of entries) {
    const row: SheetRow = { slug: entry.slug, name: entry.name, images: [] }
    await addImage(row, 'shipped', join(source, entry.file), outDir)
    for (const variant of args.draw) {
      const file = join(outDir, `${entry.slug}-${variant}.png`)
      try {
        writeFileSync(file, await drawVariant(variantPrompt(entry.prompt, variant), apiKey ?? ''))
        await addImage(row, variant, file, outDir)
      } catch (error) {
        console.log(`${entry.slug} ${variant} FAILED: ${String(error).slice(0, 200)}`)
      }
    }
    rows.push(row)
  }

  writeFileSync(
    join(outDir, 'results.json'),
    JSON.stringify(
      { startedAt, source, options: DEFAULT_HUE_OPTIONS, variants: args.draw, rows },
      null,
      2,
    ),
  )
  writeFileSync(
    join(outDir, 'index.html'),
    renderContactSheet(rows, { startedAt, options: DEFAULT_HUE_OPTIONS }),
  )
  console.log(`\nContact sheet: ${pathToFileURL(join(outDir, 'index.html')).href}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('spike-meal-colour failed:', error)
    process.exit(1)
  })
}
