import { prisma } from '@/lib/prisma'
import { DEFAULT_LOCALE, isPublicLocale, type Locale } from '@/lib/i18n/locales'

/**
 * Resolves the locale a transactional email should be written in.
 *
 * Household locale is the only signal used — it is what the person actually
 * chose in the product, and `Accept-Language` is not reliably available at send
 * time (the Better Auth `sendResetPassword` hook runs without request headers).
 *
 * Falls back to `en` for a user with no household, an unrecognised or retired
 * locale, or a failed lookup. The query is wrapped because both call sites are
 * best-effort sends: `sendResetPassword` deliberately swallows every error to
 * avoid leaking account existence through timing or error differences, and the
 * deletion confirmation runs after the soft-delete has already committed.
 */
export async function resolveEmailLocale(userId: string): Promise<Locale> {
  try {
    const membership = await prisma.householdMember.findFirst({
      where: { userId },
      select: { household: { select: { locale: true } } },
    })

    const locale = membership?.household.locale
    // Validated against PUBLIC_LOCALES, not KNOWN_LOCALES: a locale that is in
    // the DB but no longer offered to users should degrade to English rather
    // than ship copy we have stopped maintaining.
    return locale && isPublicLocale(locale) ? locale : DEFAULT_LOCALE
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to resolve email locale, falling back to default:', error)
    return DEFAULT_LOCALE
  }
}
