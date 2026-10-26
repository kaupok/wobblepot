import { getTranslations } from 'next-intl/server'
import { Heading } from '@/components/ui/typography'
import { HouseholdTabs } from './HouseholdTabs'

/**
 * The "Household" title and its tabs (HON-1257, HON-1264). Each tab's page owns
 * its session and household checks (`requireHouseholdMember`), because this
 * layout does not re-run when the user moves between tabs.
 */
export default async function HouseholdLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('household')

  return (
    <div className="w-full px-4 py-8">
      {/* A form page with a short list on top: one narrow column, so the
          page keeps one right edge (HON-767, HON-1020). */}
      <div className="flex max-w-2xl flex-col gap-6">
        <Heading variant="h4" as="h1">
          {t('pageTitle')}
        </Heading>
        <HouseholdTabs />
        {children}
      </div>
    </div>
  )
}
