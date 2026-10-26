import type { MetadataRoute } from 'next'
import { getTranslations } from 'next-intl/server'
import { getAppIcons } from '@/lib/app-icons'
import { clientEnv } from '@/lib/env'

/**
 * The PWA install description follows the request locale through next-intl's
 * request config. In practice that is Accept-Language: browsers fetch the
 * manifest without cookies (Next adds `crossorigin="use-credentials"` to the
 * manifest link on Vercel previews only), so there is no session and no
 * household locale to read.
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
    icons: getAppIcons(clientEnv.NEXT_PUBLIC_APP_ENV).manifest,
  }
}
