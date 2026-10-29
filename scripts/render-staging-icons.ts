/**
 * Staging icon set (HON-1320)
 *
 * Staging and production tabs looked identical, so the staging icons carry a
 * yellow dot in the top-right corner. `src/lib/app-icons.ts` picks this set
 * when `NEXT_PUBLIC_APP_ENV` is `staging`.
 *
 * The script adds the dot to the production masters in `public/brand/` and
 * writes `wobblepot-icon-staging.svg` and `wobblepot-icon-apple-staging.svg`
 * next to them, then renders `public/icons/staging/`: the 192 and 512 px PWA
 * icons, the 180 px Apple icon and a 16/32/48 px `favicon.ico`. Run it again
 * after a change to a master, so the two sets do not drift apart.
 *
 * Usage:
 *   npx tsx scripts/render-staging-icons.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import sharp from 'sharp'

/**
 * In the 128-unit viewBox. The fill is 34 units wide, about 27% of the tile and
 * 4 px at 16 px; the paper ring brings it to 30%, separates it from the dark
 * tile and outlines it on a light sidebar. The centre keeps the ring clear of
 * the `w` and inside the tile's rounded corner.
 */
export const STAGING_DOT =
  '<circle cx="107" cy="21" r="17" fill="#facc15" stroke="#fafafa" stroke-width="4"/>'

export function addStagingDot(svg: string): string {
  if (!svg.trimEnd().endsWith('</svg>')) throw new Error('Not an SVG document')
  return svg.trimEnd().replace(/<\/svg>$/, `${STAGING_DOT}</svg>`) + '\n'
}

/** An ICO container with PNG payloads, which every current browser reads. */
export function buildIco(frames: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * frames.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(frames.length, 4)
  let offset = header.length
  frames.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4) // colour planes
    header.writeUInt16LE(32, entry + 6) // bits per pixel
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...frames.map((frame) => frame.png)])
}

function render(svg: string, size: number): Promise<Buffer> {
  // The masters are 128 units wide at 72 dpi, so scale the density to land
  // on `size` px before the resize rather than upscale a small raster.
  return sharp(Buffer.from(svg), { density: (72 * size) / 128 })
    .resize(size, size)
    .png()
    .toBuffer()
}

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const brand = path.join(root, 'public/brand')
  const out = path.join(root, 'public/icons/staging')
  mkdirSync(out, { recursive: true })

  const tile = addStagingDot(readFileSync(path.join(brand, 'wobblepot-icon.svg'), 'utf8'))
  const apple = addStagingDot(readFileSync(path.join(brand, 'wobblepot-icon-apple.svg'), 'utf8'))
  writeFileSync(path.join(brand, 'wobblepot-icon-staging.svg'), tile)
  writeFileSync(path.join(brand, 'wobblepot-icon-apple-staging.svg'), apple)

  writeFileSync(path.join(out, 'icon-192x192.png'), await render(tile, 192))
  writeFileSync(path.join(out, 'icon-512x512.png'), await render(tile, 512))
  // The Apple icon is a full square with no alpha, as in production: iOS
  // cuts its own shape and fills transparency with black.
  const applePng = await sharp(await render(apple, 180))
    .flatten({ background: '#171717' })
    .png()
    .toBuffer()
  writeFileSync(path.join(out, 'apple-touch-icon.png'), applePng)

  const frames = await Promise.all(
    [16, 32, 48].map(async (size) => ({ size, png: await render(tile, size) })),
  )
  writeFileSync(path.join(out, 'favicon.ico'), buildIco(frames))
  console.log(`Wrote the staging icons to ${path.relative(root, out)}/`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
