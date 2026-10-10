import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import enMessages from '../../../../../messages/en.json'
import { GET } from './route'
import { loadSampleWeek } from '@/lib/meal-plans/load-sample-week'
import type { SampleMealInput } from '@/lib/meal-plans/build-sample-week'
import { SAMPLE_WEEKS } from '@/lib/meal-plans/sample-weeks'

// `next/og` compiles the element through satori + resvg (WASM), which does not
// run under jsdom (see src/app/opengraph-image.test.tsx). The mock keeps the
// element and the options, and answers as a PNG response would, so the route's
// own JSX, size and headers are what is under test.
const imageResponse = vi.fn()
vi.mock('next/og', () => ({
  ImageResponse: class extends Response {
    constructor(element: ReactElement, options: { headers?: Record<string, string> }) {
      super(null, { headers: { 'content-type': 'image/png', ...options.headers } })
      imageResponse(element, options)
    }
  },
}))

vi.mock('@/lib/meal-plans/load-sample-week', () => ({
  loadSampleWeek: vi.fn(),
}))

function meal(index: number, ready: boolean): SampleMealInput {
  return {
    id: `meal-${index}`,
    name: `Meal ${index}`,
    description: null,
    kidFriendly: true,
    timeMinutes: 30,
    primaryProteinType: 'fish',
    imageUrl: ready ? `https://x.public.blob.vercel-storage.com/meal-${index}.webp` : null,
    imageStatus: ready ? 'ready' : 'none',
    imageHue: null,
    steps: null,
    components: [],
  }
}

/** A week of seven meals, the first `ready` of them with an image. */
function week(ready: number): SampleMealInput[] {
  return Array.from({ length: 7 }, (_, index) => meal(index, index < ready))
}

async function get(slug: string) {
  return GET(new Request(`https://wobblepot.com/meal-plans/${slug}/pin.png`), {
    params: Promise.resolve({ slug }),
  })
}

function rendered() {
  const [element, options] = imageResponse.mock.calls.at(-1) as [
    ReactElement,
    { width: number; height: number },
  ]
  return { markup: renderToStaticMarkup(element), options }
}

function imageCount(markup: string) {
  return markup.match(/<img /g)?.length ?? 0
}

describe('GET /meal-plans/[slug]/pin.png', () => {
  beforeEach(() => {
    imageResponse.mockClear()
    vi.mocked(loadSampleWeek).mockReset()
    vi.mocked(loadSampleWeek).mockResolvedValue(week(7))
  })

  it('is 404 for an unknown slug, without loading anything', async () => {
    const response = await get('nut-free-week')
    expect(response.status).toBe(404)
    expect(loadSampleWeek).not.toHaveBeenCalled()
    expect(imageResponse).not.toHaveBeenCalled()
  })

  it.each(SAMPLE_WEEKS.map((w) => w.slug))(
    'renders %s as a 1000 × 1500 PNG with its title and the domain',
    async (slug) => {
      const response = await get(slug)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/png')
      const { markup, options } = rendered()
      expect(options).toMatchObject({ width: 1000, height: 1500 })
      const titles: Record<string, { title: string }> = enMessages.meta.mealPlans
      expect(markup).toContain(titles[slug]!.title.replace(/'/g, '&#x27;'))
      expect(markup).toContain('wobblepot.com')
    },
  )

  it('caches for a day rather than the no-cache default', async () => {
    const response = await get('family-of-four')
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400, s-maxage=86400')
  })

  it('shows at most six of the week’s ready images, by URL', async () => {
    await get('family-of-four')
    const { markup } = rendered()
    expect(imageCount(markup)).toBe(6)
    expect(markup).toContain('https://x.public.blob.vercel-storage.com/meal-0.webp')
    expect(markup).not.toContain('meal-6.webp')
  })

  it('leaves out meals whose image is not ready', async () => {
    vi.mocked(loadSampleWeek).mockResolvedValue(week(4))
    await get('family-of-four')
    expect(imageCount(rendered().markup)).toBe(4)
  })

  it('takes an even number of images, so no grid cell is empty', async () => {
    vi.mocked(loadSampleWeek).mockResolvedValue(week(5))
    await get('family-of-four')
    expect(imageCount(rendered().markup)).toBe(4)
  })

  it.each([0, 1])('renders the title without a grid when %i image is ready', async (ready) => {
    vi.mocked(loadSampleWeek).mockResolvedValue(week(ready))
    const response = await get('vegetarian-week')
    expect(response.status).toBe(200)
    const { markup } = rendered()
    expect(imageCount(markup)).toBe(0)
    expect(markup).toContain('A week of vegetarian family dinners')
    expect(markup).toContain('background-color:#171717')
  })
})
