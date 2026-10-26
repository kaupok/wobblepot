import type { Metadata, MetadataRoute } from 'next'

/**
 * The favicon, PWA and Apple icons for this deployment (HON-1320).
 *
 * Staging (`wobblepot.dev`) gets the tile with a yellow dot, so its tab differs
 * from production's. Every other environment keeps the production set.
 * `NEXT_PUBLIC_APP_ENV` is inlined at build time and each Vercel environment
 * builds separately, so a build-time check is correct.
 *
 * Maskable icons stay production on staging: a corner dot falls outside the
 * maskable safe zone, so the platform would crop it.
 */
export function getAppIcons(appEnv: string | undefined): {
  metadata: NonNullable<Metadata['icons']>
  manifest: NonNullable<MetadataRoute.Manifest['icons']>
} {
  const staging = appEnv === 'staging'
  const dir = staging ? '/icons/staging' : '/icons'
  const favicon = staging ? '/icons/staging/favicon.ico' : '/favicon.ico'
  const icon192 = `${dir}/icon-192x192.png`
  const icon512 = `${dir}/icon-512x512.png`

  return {
    metadata: {
      icon: [
        { url: favicon, sizes: 'any' },
        { url: icon192, sizes: '192x192', type: 'image/png' },
        { url: icon512, sizes: '512x512', type: 'image/png' },
      ],
      apple: [{ url: `${dir}/apple-touch-icon.png`, sizes: '180x180', type: 'image/png' }],
    },
    manifest: [
      { src: icon192, sizes: '192x192', type: 'image/png' },
      { src: icon512, sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
