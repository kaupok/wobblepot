import { getTranslations } from 'next-intl/server'
import { getSession, getHasHousehold } from '@/lib/session'
import { HeaderChrome } from './header-chrome'

/**
 * Resolves the session and hands it to `HeaderChrome`, which owns the markup.
 * Split this way because `getSession()` and `getHasHousehold()` import Prisma
 * transitively, so the chrome could not otherwise be mounted in Storybook.
 */
export async function Header() {
  const session = await getSession()
  const hasHousehold = session ? await getHasHousehold(session.user.id) : false
  const t = await getTranslations('nav')

  return (
    <HeaderChrome
      session={session}
      hasHousehold={hasHousehold}
      skipToContentLabel={t('skipToContent')}
    />
  )
}
