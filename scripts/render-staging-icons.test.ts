import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { addStagingDot, buildIco } from './render-staging-icons'

const root = path.resolve(__dirname, '..')
const staging = path.join(root, 'public/icons/staging')

/** Read the ICO directory by hand, so the test does not trust `buildIco`. */
function icoFrames(ico: Buffer): { size: number; png: Buffer }[] {
  expect(ico.readUInt16LE(2)).toBe(1)
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const entry = 6 + 16 * i
    const length = ico.readUInt32LE(entry + 8)
    const offset = ico.readUInt32LE(entry + 12)
    return { size: ico.readUInt8(entry) || 256, png: ico.subarray(offset, offset + length) }
  })
}

type Rgba = [number, number, number, number]

async function pixel(png: Buffer, x: number, y: number): Promise<Rgba> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * 4
  return [data[at]!, data[at + 1]!, data[at + 2]!, data[at + 3]!]
}

const isYellow = ([r, g, b, a]: Rgba) => r > 200 && g > 160 && b < 100 && a > 200
const isTile = ([r, g, b, a]: Rgba) => r < 40 && g < 40 && b < 40 && a > 200

describe('the committed staging favicon', () => {
  const ico = readFileSync(path.join(staging, 'favicon.ico'))

  it('holds 16, 32 and 48 px frames', () => {
    expect(icoFrames(ico).map((frame) => frame.size)).toEqual([16, 32, 48])
  })

  // HON-1320: the dot must survive the smallest tab icon.
  it('shows the yellow dot in the top-right corner of the 16 px frame', async () => {
    const [frame16] = icoFrames(ico)

    expect(isYellow(await pixel(frame16!.png, 13, 3))).toBe(true)
    expect(isTile(await pixel(frame16!.png, 2, 8))).toBe(true)
  })
})

describe('the committed staging PNGs', () => {
  it.each([
    ['icon-192x192.png', 192],
    ['icon-512x512.png', 512],
    ['apple-touch-icon.png', 180],
  ])('%s is %i px with the yellow dot', async (name, size) => {
    const png = readFileSync(path.join(staging, name))
    const { width, height } = await sharp(png).metadata()

    expect([width, height]).toEqual([size, size])
    expect(
      isYellow(await pixel(png, Math.round((107 / 128) * size), Math.round((21 / 128) * size))),
    ).toBe(true)
  })

  it('has the staging SVG masters beside the production ones', () => {
    expect(existsSync(path.join(root, 'public/brand/wobblepot-icon-staging.svg'))).toBe(true)
    expect(existsSync(path.join(root, 'public/brand/wobblepot-icon-apple-staging.svg'))).toBe(true)
  })
})

describe('addStagingDot', () => {
  it('adds the yellow circle as the last element', () => {
    expect(addStagingDot('<svg viewBox="0 0 128 128"><rect/></svg>')).toBe(
      '<svg viewBox="0 0 128 128"><rect/><circle cx="107" cy="21" r="17" fill="#facc15" stroke="#fafafa" stroke-width="4"/></svg>\n',
    )
  })

  it('rejects text that is not an SVG document', () => {
    expect(() => addStagingDot('<png/>')).toThrow('Not an SVG document')
  })
})

describe('buildIco', () => {
  it('writes a 256 px frame as size 0 and points each entry at its payload', () => {
    const ico = buildIco([
      { size: 16, png: Buffer.from('aa') },
      { size: 256, png: Buffer.from('bbb') },
    ])

    expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 2, 0])
    expect(ico.readUInt8(6)).toBe(16)
    expect(ico.readUInt8(22)).toBe(0)
    expect(ico.readUInt32LE(6 + 12)).toBe(38)
    expect(ico.readUInt32LE(22 + 12)).toBe(40)
    expect(ico.subarray(38).toString()).toBe('aabbb')
  })
})
