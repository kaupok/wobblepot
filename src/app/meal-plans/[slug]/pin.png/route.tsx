/* eslint-disable shadcn/no-inline-styles -- ImageResponse renders through satori, which has no Tailwind and no stylesheet: inline styles are the only way to style this route. */
import { ImageResponse } from 'next/og'
import enMessages from '../../../../../messages/en.json'
import { loadSampleWeek } from '@/lib/meal-plans/load-sample-week'
import { SAMPLE_PIN_SIZE } from '@/lib/meal-plans/pinterest'
import { findSampleWeek } from '@/lib/meal-plans/sample-weeks'

/**
 * A sample week's Pinterest image (HON-1148): 1000 × 1500, the 2:3 ratio
 * Pinterest recommends, because a landscape image is cropped in the feed and
 * the meal images are 3:2. The page's "Save to Pinterest" link hands this URL
 * to Pinterest as `media`.
 *
 * Built like `src/app/opengraph-image.tsx`, which explains the choices: the
 * bundled Geist Regular (no `fonts` option), colours as literal sRGB because
 * satori parses neither `var()` nor `oklch()`, and the English title read
 * straight from `en.json` because the pages are English-only (HON-1073).
 *   #171717 ← --primary            surface
 *   #fafafa ← --primary-foreground title
 *   #a1a1a1 ← --muted-foreground   (dark) domain
 *
 * The meal images are the week's `ready` ones, which satori fetches from Blob
 * by URL while it renders. The grid takes an even number of them, at most six,
 * so no cell is left empty. With fewer than two, the title fills the surface
 * on its own.
 */

const MAX_IMAGES = 6
const PADDING = 64
const GAP = 16
const CELL_WIDTH = (SAMPLE_PIN_SIZE.width - 2 * PADDING - GAP) / 2
const CELL_HEIGHT = Math.round((CELL_WIDTH * 2) / 3)

/**
 * A day, as the loader's cache does: the meals change only on a seed run or an
 * image batch. Replaces `next/og`'s default `public, max-age=0,
 * must-revalidate`, so the CDN keeps the PNG and a crawl does not render it
 * again. `next/og` merges `headers` with `Headers.set`, so the key's case does
 * not matter (`next/dist/server/og/image-response.js`).
 */
const CACHE_CONTROL = 'public, max-age=86400, s-maxage=86400'

const TITLES: Record<string, { title: string } | undefined> = enMessages.meta.mealPlans

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const week = findSampleWeek((await params).slug)
  const title = week && TITLES[week.slug]?.title
  if (!week || !title) return new Response(null, { status: 404 })

  const ready = (await loadSampleWeek(week)).flatMap((meal) =>
    meal.imageStatus === 'ready' && meal.imageUrl ? [meal.imageUrl] : [],
  )
  const count = Math.min(MAX_IMAGES, ready.length - (ready.length % 2))
  const images = ready.slice(0, count)
  const withGrid = images.length >= 2

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: `${PADDING}px`,
        backgroundColor: '#171717',
      }}
    >
      {/* The title and the grid stay together, centred in the space above
          the domain, whatever the number of images. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          justifyContent: 'center',
          gap: '64px',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: withGrid ? 80 : 104,
            lineHeight: 1.1,
            letterSpacing: '-2px',
            color: '#fafafa',
          }}
        >
          {title}
        </div>
        {withGrid && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: `${GAP}px` }}>
            {images.map((src) => (
              // satori draws `<img>`; next/image does not exist in this renderer.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt=""
                width={CELL_WIDTH}
                height={CELL_HEIGHT}
                style={{ objectFit: 'cover', borderRadius: '16px' }}
              />
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', fontSize: 40, color: '#a1a1a1' }}>wobblepot.com</div>
    </div>,
    { ...SAMPLE_PIN_SIZE, headers: { 'Cache-Control': CACHE_CONTROL } },
  )
}
