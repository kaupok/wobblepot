import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { BookOpen, CookingPot, Refrigerator, Users } from 'lucide-react'
import { Body, Heading } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { LandingDemo } from '@/components/landing/LandingDemo'
import { LandingShowcase } from '@/components/landing/LandingShowcase'
import { formatDayLong } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import type { DemoDay } from '@/lib/landing/load-demo-day'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { SUPPORT_EMAIL, supportMailtoHref } from '@/lib/support'

const STEPS = ['table', 'week', 'shop'] as const

const DIFFERENCES = [
  { key: 'pantry', Icon: Refrigerator },
  { key: 'recipes', Icon: BookOpen },
  { key: 'kids', Icon: Users },
  { key: 'cook', Icon: CookingPot },
] as const

interface LandingPageProps {
  /** `invite_code_required`: sign-up needs a code, so the call to action says so. */
  inviteRequired: boolean
  locale: Locale
  /**
   * Today's three library meals, each opening the cook view
   * (`loadDemoDay`), or null when the library cannot fill a day, in which
   * case the static example day stands in.
   */
  demo: DemoDay | null
}

/**
 * The signed-out home page. One page, read top to bottom: the problem and the
 * promise, today's three meals drawn with the planner's own cards (each one
 * opening the cook view), how it works in three steps, what makes it
 * different, and the call to action again.
 *
 * Not `<main>`: the root layout's `<main id="main-content">` is the page
 * landmark (HON-820). Left-aligned and capped at the page width like the app,
 * so the landing reads as the first screen of the product, not a brochure.
 */
export async function LandingPage({ inviteRequired, locale, demo }: LandingPageProps) {
  const [t, tSignUp] = await Promise.all([
    getTranslations('landing'),
    getTranslations('auth.signUp'),
  ])

  /**
   * The call to action, under the hero and again at the end. The invite line
   * is a `note` landmark once, in the hero: the closing copy repeats the
   * words, not the landmark.
   */
  const renderCta = ({ note }: { note: boolean }) => (
    <div className="flex flex-col gap-3">
      <Button asChild size="lg" className="w-full md:w-auto md:self-start">
        <Link href="/sign-up">{inviteRequired ? t('ctaWithCode') : t('cta')}</Link>
      </Button>
      {inviteRequired ? (
        <Body
          variant="muted"
          role={note ? 'note' : undefined}
          aria-label={note ? tSignUp('privateBetaNoticeLabel') : undefined}
        >
          {t('privateBeta')}{' '}
          {tSignUp.rich('requestInvite', {
            email: SUPPORT_EMAIL,
            link: (chunks) => (
              <a
                href={supportMailtoHref(tSignUp('requestInviteSubject'))}
                className="text-foreground underline underline-offset-2"
              >
                {chunks}
              </a>
            ),
          })}
        </Body>
      ) : (
        <Body variant="muted">{t('free')}</Body>
      )}
    </div>
  )

  return (
    <div className="w-full px-4 py-8 md:py-12">
      <div className="flex flex-col gap-16 md:gap-24">
        {/* Hero: the promise on the left, the product on the right from lg. The
            demo is capped at the planner card's width at every size: an uncapped
            card below lg is wide and short, and its cover image crops the plate. */}
        <section className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-4 text-balance">
              <Heading>{t('headline')}</Heading>
              <Body variant="lead">{t('sub')}</Body>
            </div>
            {renderCta({ note: true })}
          </div>
          <div className="w-full max-w-md lg:justify-self-end">
            {demo ? (
              <LandingDemo day={demo} dayLabel={formatDayLong(parseLocalDate(demo.date), locale)} />
            ) : (
              <LandingShowcase />
            )}
          </div>
        </section>

        <section aria-labelledby="landing-how" className="flex flex-col gap-8">
          <Heading variant="h3" as="h2" id="landing-how">
            {t('how.title')}
          </Heading>
          {/* WebKit drops list semantics from a `list-style: none` list, so the role
              restores "list, 3 items" (as `Ol variant="plain"` does). A raw list
              because the grid's gap is the layout here, which `Ol` owns. */}
          <ol role="list" className="grid list-none gap-8 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step}>
                <div className="flex flex-col gap-2">
                  <Body variant="caption">{t('how.step', { number: index + 1 })}</Body>
                  <Heading variant="section" as="h3">
                    {t(`how.${step}.title`)}
                  </Heading>
                  <Body variant="muted">{t(`how.${step}.body`)}</Body>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="landing-why" className="flex flex-col gap-8">
          <Heading variant="h3" as="h2" id="landing-why">
            {t('why.title')}
          </Heading>
          <ul role="list" className="grid list-none gap-8 md:grid-cols-2">
            {DIFFERENCES.map(({ key, Icon }) => (
              <li key={key}>
                <div className="flex gap-3">
                  <Icon aria-hidden="true" className="mt-1 size-5 shrink-0" />
                  <div className="flex flex-col gap-2">
                    <Heading variant="section" as="h3">
                      {t(`why.${key}.title`)}
                    </Heading>
                    <Body variant="muted">{t(`why.${key}.body`)}</Body>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="landing-close" className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 text-balance">
            <Heading variant="h3" as="h2" id="landing-close">
              {t('close.title')}
            </Heading>
            <Body variant="muted">{t('close.body')}</Body>
          </div>
          {renderCta({ note: false })}
        </section>
      </div>
    </div>
  )
}
