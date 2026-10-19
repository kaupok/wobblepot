import { getTranslations } from 'next-intl/server'
import { Heading, Body } from '@/components/ui/typography'
import { AccountTabs } from './AccountTabs'

/**
 * The "My account" title and its four tabs (HON-1229, HON-1256). Each tab's
 * page owns its session and household checks (`requireAccountMember`),
 * because this layout does not re-run when the user moves between tabs.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('account')

  return (
    <div className="w-full px-4 py-8">
      {/* A form page: a narrow column, top-aligned, no page-level Card (HON-767). */}
      <div className="flex max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Heading variant="h4" as="h1">
            {t('title')}
          </Heading>
          <Body variant="muted">{t('description')}</Body>
        </div>
        <AccountTabs />
        {children}
      </div>
    </div>
  )
}
