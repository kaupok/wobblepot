/**
 * Generate placeholder PWA icons for Honkadori.
 * Produces a white "H" on a branded teal background.
 *
 * Usage: pnpm icons:generate
 */

import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.resolve(__dirname, '..', 'public', 'icons')
const BRAND_COLOR = '#0d9488' // teal-600

interface IconSpec {
  name: string
  size: number
  /** Maskable icons use 80% of the canvas for the icon, 20% safe-zone padding */
  maskable?: boolean
}

const icons: IconSpec[] = [
  { name: 'icon-192x192.png', size: 192 },
  { name: 'icon-512x512.png', size: 512 },
  { name: 'icon-maskable-192x192.png', size: 192, maskable: true },
  { name: 'icon-maskable-512x512.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180 },
]

function buildSvg(size: number, maskable: boolean): Buffer {
  // For maskable icons, the "H" is smaller so it fits within the safe zone (inner 80%)
  const fontSize = maskable ? size * 0.45 : size * 0.55
  const bgRadius = maskable ? 0 : size * 0.12

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" rx="${bgRadius}" fill="${BRAND_COLOR}" />
      <text
        x="50%" y="50%"
        dominant-baseline="central"
        text-anchor="middle"
        font-family="system-ui, -apple-system, sans-serif"
        font-weight="700"
        font-size="${fontSize}"
        fill="white"
      >H</text>
    </svg>
  `)
}

async function main() {
  console.log(`Generating ${icons.length} icons into ${OUTPUT_DIR}\n`)

  for (const icon of icons) {
    const svg = buildSvg(icon.size, icon.maskable ?? false)
    const output = path.join(OUTPUT_DIR, icon.name)

    await sharp(svg).png().toFile(output)

    console.log(`  ✓ ${icon.name} (${icon.size}×${icon.size}${icon.maskable ? ', maskable' : ''})`)
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error('Icon generation failed:', err)
  process.exit(1)
})
