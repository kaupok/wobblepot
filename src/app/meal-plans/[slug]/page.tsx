import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { Body, Heading } from '@/components/ui/typography'
import { SampleMealCard } from '@/components/meal-plans/SampleMealCard'
import { SampleShoppingList } from '@/components/meal-plans/SampleShoppingList'
import { getServerBaseURL } from '@/lib/env'
import { buildSampleWeek, serializeJsonLd } from '@/lib/meal-plans/build-sample-week'
import { loadSampleWeek } from '@/lib/meal-plans/load-sample-week'
import { pinterestSaveUrl, samplePinPath } from '@/lib/meal-plans/pinterest'
import { findSampleWeek, sampleWeekPath } from '@/lib/meal-plans/sample-weeks'

/**
 * English for every visitor, whatever the request's locale: the first market
 * is English (HON-1073). Passed to every `getTranslations` call and to the
 * nested provider below, so no header, cookie or session is read for it.
 */
const LOCALE = 'en'

interface MealPlanPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: MealPlanPageProps): Promise<Metadata> {
  const week = findSampleWeek((await params).slug)
  if (!week) notFound()
  const t = await getTranslations({ locale: LOCALE, namespace: `meta.mealPlans.${week.slug}` })
  // No `openGraph`: setting it replaces the root's, image included (see
  // src/app/opengraph-image.tsx).
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: sampleWeekPath(week.slug) },
  }
}

/**
 * A public sample meal plan (HON-1085): one hand-picked week of library
 * dinners scaled for a stated household, its shopping list, and a call to
 * action to the waitlist with the page's `ref` (HON-1089). Public: `/meal-plans`
 * is in `PUBLIC_ROUTES` (src/proxy.ts), and the page reads no session.
 */
export default async function MealPlanPage({ params }: MealPlanPageProps) {
  const week = findSampleWeek((await params).slug)
  if (!week) notFound()

  const [t, tMeta, tLanding, tVague, tUnit, messages, meals] = await Promise.all([
    getTranslations({ locale: LOCALE, namespace: 'mealPlans' }),
    getTranslations({ locale: LOCALE, namespace: `meta.mealPlans.${week.slug}` }),
    getTranslations({ locale: LOCALE, namespace: 'landing' }),
    getTranslations({ locale: LOCALE, namespace: 'enums.VaguePhrase' }),
    getTranslations({ locale: LOCALE, namespace: 'enums.Unit' }),
    getMessages({ locale: LOCALE }),
    loadSampleWeek(week),
  ])

  const title = tMeta('title')
  const baseUrl = getServerBaseURL()
  const pageUrl = `${baseUrl}${sampleWeekPath(week.slug)}`
  const view = buildSampleWeek(week, meals, {
    pageUrl,
    title,
    recipeYield: (servings) => t('recipeYield', { servings }),
    tVague: (key) => tVague(key),
    pieceLabel: tUnit('piece'),
  })

  return (
    // The client components (badges, enum labels) read this provider, not the
    // root one, so an Estonian visitor still sees one English page.
    <NextIntlClientProvider
      locale={LOCALE}
      messages={{
        enums: messages.enums,
        'meal-plan': { detail: messages['meal-plan'].detail },
        mealPlans: messages.mealPlans,
      }}
    >
      <div lang={LOCALE} className="w-full px-4 py-8">
        <script
          type="application/ld+json"
          // A data block, not a script: the CSP's `script-src` does not apply
          // to it, so it needs no nonce. `serializeJsonLd` escapes every `<`.
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(view.jsonLd) }}
        />
        <div className="flex flex-col gap-10">
          <div className="flex max-w-4xl flex-col gap-5 text-balance">
            <Heading variant="hero" face="brand" as="h1">
              {title}
            </Heading>
            <div className="max-w-2xl">
              <Body variant="lead">
                {t('lead', {
                  household: t(`households.${week.slug}`),
                  servings: view.servings,
                })}
              </Body>
            </div>
          </div>

          <section aria-labelledby="sample-week-dinners" className="flex flex-col gap-4">
            <Heading variant="h2" id="sample-week-dinners">
              {t('weekHeading')}
            </Heading>
            <div className="grid gap-4 md:grid-cols-2">
              {view.days.map((day) => (
                <SampleMealCard key={day.anchor} day={day} />
              ))}
            </div>
          </section>

          <section aria-labelledby="sample-week-shopping" className="flex max-w-2xl flex-col gap-4">
            <Heading variant="h2" id="sample-week-shopping">
              {t('shoppingHeading')}
            </Heading>
            <SampleShoppingList groups={view.shoppingList} />
          </section>

          <div className="flex max-w-2xl flex-col gap-4">
            <Body variant="muted">{t('disclaimer')}</Body>
            <div className="flex flex-col gap-3 md:flex-row">
              <Button asChild size="lg" className="w-full md:w-auto">
                <Link href={`/request-invite?ref=${week.ref}`}>{tLanding('cta')}</Link>
              </Button>
              {/* A plain link, not Pinterest's script: no third-party code on
                  the page and no CSP change (HON-1148). */}
              <Button asChild size="lg" variant="outline" className="w-full md:w-auto">
                <a
                  href={pinterestSaveUrl({
                    pageUrl,
                    mediaUrl: `${baseUrl}${samplePinPath(week.slug)}`,
                    description: title,
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('saveToPinterest')}
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </NextIntlClientProvider>
  )
}
