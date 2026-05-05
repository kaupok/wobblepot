import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { serverEnv } from '@/lib/env'
import { getHouseholdMembership } from '@/lib/household'
import { Heading } from '@/components/ui/typography'
import { HouseholdSettingsForm } from './household/HouseholdSettingsForm'
import { MemberList } from '@/components/household/MemberList'
import { DEFAULT_LOCALE, effectivePublicLocales, isKnownLocale } from '@/lib/i18n/locales'

export default async function HouseholdPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect('/sign-in')
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    redirect('/')
  }

  const t = await getTranslations('household')
  const isOwner = membership.role === 'owner'
  const { household } = membership

  // FEATURE_PUBLIC_LOCALES_FULL=1 widens the selector to KNOWN_LOCALES on
  // staging for dogfooding (HON-544). Read on the server so client code stays
  // free of env imports and the prop is testable in isolation.
  const fullPublicEnabled =
    serverEnv.FEATURE_PUBLIC_LOCALES_FULL === '1' ||
    serverEnv.FEATURE_PUBLIC_LOCALES_FULL === 'true'
  const publicLocales = effectivePublicLocales(fullPublicEnabled)

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <Heading>{t('pageTitle')}</Heading>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left column: Household settings */}
        <div>
          <HouseholdSettingsForm
            household={{
              id: household.id,
              name: household.name,
              timezone: household.timezone,
              locale: isKnownLocale(household.locale) ? household.locale : DEFAULT_LOCALE,
            }}
            publicLocales={publicLocales}
            preferences={
              household.preferences
                ? {
                    dietaryType: household.preferences.dietaryType,
                    allergensToAvoid: household.preferences.allergensToAvoid,
                    restrictions: household.preferences.restrictions,
                    excludedIngredients: household.preferences.excludedIngredients,
                    weekdayMealTypes: household.preferences.weekdayMealTypes,
                    weekendMealTypes: household.preferences.weekendMealTypes,
                  }
                : null
            }
            isOwner={isOwner}
          />
        </div>

        {/* Right column: Members */}
        <div>
          <MemberList isOwner={isOwner} currentMemberId={membership.id} />
        </div>
      </div>
    </div>
  )
}
