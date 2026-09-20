import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import enMessages from '../../messages/en.json'

// `next/og` compiles the element tree through satori + resvg (WASM). That does
// not run under jsdom, and rendering a real PNG is not what this test is for.
// The mock keeps the element and the options so the real module's JSX and
// exports are still the thing under test.
const imageResponse = vi.fn()
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(element: ReactElement, options: unknown) {
      imageResponse(element, options)
    }
  },
}))

const { ogTitle, ogDescription } = enMessages.meta.root

describe('opengraph-image', () => {
  it('declares the 1200x630 PNG the file convention expects', async () => {
    const { size, contentType } = await import('./opengraph-image')

    expect(size).toEqual({ width: 1200, height: 630 })
    expect(contentType).toBe('image/png')
  })

  it('takes its alt text from the meta.root message keys', async () => {
    const { alt } = await import('./opengraph-image')

    expect(alt).toContain(ogTitle)
    expect(alt).toContain(ogDescription)
  })

  it('renders the wordmark and tagline from the same keys generateMetadata reads', async () => {
    const { default: Image, size } = await import('./opengraph-image')
    imageResponse.mockClear()

    Image()

    expect(imageResponse).toHaveBeenCalledTimes(1)
    const [element, options] = imageResponse.mock.calls[0] as [
      ReactElement,
      { width: number; height: number },
    ]

    expect(options).toMatchObject(size)

    const markup = renderToStaticMarkup(element)
    expect(markup).toContain(ogTitle)
    expect(markup).toContain(ogDescription)
  })

  it('paints an opaque surface so the card does not rely on the host chrome', async () => {
    const { default: Image } = await import('./opengraph-image')
    imageResponse.mockClear()

    Image()

    const [element] = imageResponse.mock.calls[0] as [ReactElement]
    const markup = renderToStaticMarkup(element)

    // --primary resolved to sRGB; see the file header for the token mapping.
    expect(markup).toContain('background-color:#171717')
  })
})
