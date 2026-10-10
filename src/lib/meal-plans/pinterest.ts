import { sampleWeekPath } from './sample-weeks'

/** The pin's size: Pinterest recommends 2:3, and 1000 × 1500 is its own example size. */
export const SAMPLE_PIN_SIZE = { width: 1000, height: 1500 } as const

/** The path of a sample week's Pinterest image (HON-1148): `/meal-plans/<slug>/pin.png`. */
export function samplePinPath(slug: string): string {
  return `${sampleWeekPath(slug)}/pin.png`
}

/**
 * Pinterest's "save" URL for a page: a plain link, so the page loads no
 * Pinterest script and the CSP needs no change. `media` is the pin image
 * Pinterest takes; `description` prefills the pin's text.
 */
export function pinterestSaveUrl({
  pageUrl,
  mediaUrl,
  description,
}: {
  pageUrl: string
  mediaUrl: string
  description: string
}): string {
  const params = new URLSearchParams({ url: pageUrl, media: mediaUrl, description })
  return `https://www.pinterest.com/pin/create/button/?${params.toString()}`
}
