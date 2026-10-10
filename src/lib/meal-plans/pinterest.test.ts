import { describe, expect, it } from 'vitest'
import { pinterestSaveUrl, samplePinPath } from './pinterest'

describe('samplePinPath', () => {
  it('puts the image under the page', () => {
    expect(samplePinPath('vegetarian-week')).toBe('/meal-plans/vegetarian-week/pin.png')
  })
})

describe('pinterestSaveUrl', () => {
  it('encodes the page, the image and the description as query parameters', () => {
    const url = new URL(
      pinterestSaveUrl({
        pageUrl: 'https://wobblepot.com/meal-plans/family-of-four',
        mediaUrl: 'https://wobblepot.com/meal-plans/family-of-four/pin.png',
        description: 'Seven dinners & one list',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://www.pinterest.com/pin/create/button/')
    expect(url.searchParams.get('url')).toBe('https://wobblepot.com/meal-plans/family-of-four')
    expect(url.searchParams.get('media')).toBe(
      'https://wobblepot.com/meal-plans/family-of-four/pin.png',
    )
    expect(url.searchParams.get('description')).toBe('Seven dinners & one list')
    // The `&` in the description is encoded, so it cannot start a parameter.
    expect([...url.searchParams.keys()]).toEqual(['url', 'media', 'description'])
  })
})
