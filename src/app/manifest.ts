import type { MetadataRoute } from 'next'
import { getTranslations } from 'next-intl/server'

/**
 * The PWA install description follows the request locale (household, then
 * Accept-Language) through next-intl's request config, like every page title.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations('meta.manifest')
  return {
    name: 'Wobblepot',
    short_name: 'Wobblepot',
    description: t('description'),
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
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
