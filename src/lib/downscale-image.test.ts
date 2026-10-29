// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DOWNSCALE_SKIP_BYTES, downscaleImage } from './downscale-image'

function photo(bytes: number, name = 'page.png', type = 'image/png') {
  return new File([new Uint8Array(bytes)], name, { type, lastModified: 1234 })
}

const LARGE = DOWNSCALE_SKIP_BYTES + 1

describe('downscaleImage', () => {
  let context: {
    fillStyle: string
    fillRect: ReturnType<typeof vi.fn>
    drawImage: ReturnType<typeof vi.fn>
  }
  let canvasSize: { width: number; height: number }
  let blobBytes: number
  const close = vi.fn()

  beforeEach(() => {
    blobBytes = 400_000
    context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 4032, height: 3024, close })),
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      canvasSize = { width: this.width, height: this.height }
      return context as never
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) =>
      callback(new Blob([new Uint8Array(blobBytes)], { type })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends a photo at or under 1 MB as it is', async () => {
    const small = photo(DOWNSCALE_SKIP_BYTES)
    expect(await downscaleImage(small)).toBe(small)
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('redraws a large photo as a JPEG with a 1568 px long edge', async () => {
    const result = await downscaleImage(photo(LARGE, 'cookbook page.png'))

    expect(canvasSize).toEqual({ width: 1568, height: 1176 })
    expect(context.fillStyle).toBe('#fff')
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1568, 1176)
    expect(close).toHaveBeenCalled()
    expect(result.type).toBe('image/jpeg')
    expect(result.name).toBe('cookbook page.jpg')
    expect(result.size).toBe(400_000)
    expect(result.lastModified).toBe(1234)
  })

  it('keeps the size of a large file whose pixels are already small', async () => {
    vi.mocked(createImageBitmap).mockResolvedValue({ width: 800, height: 600, close } as never)
    await downscaleImage(photo(LARGE))
    expect(canvasSize).toEqual({ width: 800, height: 600 })
  })

  it('keeps the original when the JPEG is not smaller', async () => {
    blobBytes = LARGE + 10
    const original = photo(LARGE)
    expect(await downscaleImage(original)).toBe(original)
  })

  it('keeps the original when the browser cannot decode it', async () => {
    vi.mocked(createImageBitmap).mockRejectedValue(new Error('decode failed'))
    const original = photo(LARGE)
    expect(await downscaleImage(original)).toBe(original)
  })

  it('keeps the original where createImageBitmap does not exist', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const original = photo(LARGE)
    expect(await downscaleImage(original)).toBe(original)
  })
})
