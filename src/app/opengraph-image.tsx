/* eslint-disable shadcn/no-inline-styles -- ImageResponse renders through satori, which has no Tailwind and no stylesheet: inline styles are the only way to style this route. */
import { ImageResponse } from 'next/og'
import enMessages from '../../messages/en.json'

/**
 * Open Graph card for the site root (HON-483).
 *
 * Emitted by Next's `opengraph-image` file convention, which writes the
 * `og:image`, `og:image:type`, `og:image:width` and `og:image:height` tags
 * itself — `src/app/layout.tsx` deliberately carries no `images` entry. An
 * entry there does not add a second tag, it *replaces* this one:
 * `mergeStaticMetadata` merges the file-based image only when the segment's
 * own metadata has no `images` key
 * (`next/dist/lib/metadata/resolve-metadata.js:148`), so a per-route override
 * would silently take this card out of the HTML while the route still builds
 * and still serves a valid PNG at `/opengraph-image`. Dropping an
 * `opengraph-image.png` into this segment replaces this route with no other
 * change.
 *
 * Copy is read from the same `meta.root.ogTitle` / `meta.root.ogDescription`
 * keys `generateMetadata` uses, so the card and the meta tags cannot drift in
 * English. They do diverge for other locales — `generateMetadata` translates
 * per request while this card stays English on purpose: per-locale cards are a
 * separate, larger investment (and `getTranslations` would re-resolve the
 * request locale here, not 'en').
 *
 * Colours are the `globals.css` tokens resolved to their literal sRGB values,
 * because satori parses neither `var()` nor `oklch()`:
 *   #171717 ← --primary          (light, oklch(0.205 0 0))  card surface
 *   #fafafa ← --primary-foreground (light, oklch(0.985 0 0)) wordmark
 *   #a1a1a1 ← --muted-foreground   (dark,  oklch(0.708 0 0)) tagline
 * The surface is opaque so the card reads on both light and dark preview
 * chrome rather than borrowing the host's background.
 *
 * No `fonts` option: Geist is loaded through `next/font/google`, whose font
 * files only exist inside `.next` after the loader runs, and fetching from
 * Google Fonts here would make every build depend on an outbound request. The
 * satori default face is used instead — it ships a single weight, so don't
 * reach for `fontWeight` here expecting it to do anything; size and colour are
 * the only hierarchy this card has.
 */

const { ogTitle, ogDescription } = enMessages.meta.root

export const alt = `${ogTitle} — ${ogDescription}`

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '96px',
        backgroundColor: '#171717',
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: 104,
          letterSpacing: '-2px',
          color: '#fafafa',
        }}
      >
        {ogTitle}
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: '24px',
          fontSize: 44,
          color: '#a1a1a1',
        }}
      >
        {ogDescription}
      </div>
    </div>,
    { ...size },
  )
}
