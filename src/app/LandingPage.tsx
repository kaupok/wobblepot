import Link from 'next/link'
import { Heart } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Body, Heading } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { LandingDemo } from '@/components/landing/LandingDemo'
import { LandingFeatures } from '@/components/landing/LandingFeatures'
import { LandingShowcase } from '@/components/landing/LandingShowcase'
import { displayFont } from '@/components/landing/display-font'
import { formatDayLong } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import type { DemoDay } from '@/lib/landing/load-demo-day'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { cn } from '@/lib/utils'

const STEPS = ['table', 'week', 'shop'] as const

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
 * opening the cook view), how it works in three steps, who it is for and
 * what makes it different, each point shown with the app's own components,
 * and one closing line on who made it.
 * The call to action is in the hero only: from `md` the floating header keeps
 * "Sign up" on screen, and below `md` it is in the header's Account sheet.
 *
 * Not `<main>`: the root layout's `<main id="main-content">` is the page
 * landmark (HON-820). Capped at the page width like the app, so the landing
 * reads as the first screen of the product, not a brochure. The hero is
 * left-aligned beside the demo; each section below it opens with a centred
 * statement at the hero's size, and its content stays left-aligned.
 *
 * The page's own headings are set in the display face (`face="brand"`, HON-1043);
 * the app components it draws keep Geist, because they show the product.
 */
export async function LandingPage({ inviteRequired, locale, demo }: LandingPageProps) {
  const [t, tSignUp] = await Promise.all([
    getTranslations('landing'),
    getTranslations('auth.signUp'),
  ])

  return (
    <div className={cn('w-full px-4 py-8 md:py-12', displayFont.variable)}>
      <div className="flex flex-col gap-20 md:gap-32">
        {/* Hero: the promise on the left, the product on the right from lg. The
            demo is capped at the planner card's width at every size: an uncapped
            card below lg is wide and short, and its cover image crops the plate. */}
        <section className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-4 text-balance">
              <Heading face="brand">{t('headline')}</Heading>
              <Body variant="lead">{t('sub')}</Body>
            </div>
            <div className="flex flex-col gap-3">
              <Button asChild size="lg" className="w-full md:w-auto md:self-start">
                <Link href="/sign-up">{t('cta')}</Link>
              </Button>
              {/* The notice explains the button above it; the price line shows in
                  both modes (HON-1061), and the data line stays last. */}
              {inviteRequired && (
                <Body variant="muted" role="note" aria-label={tSignUp('privateBetaNoticeLabel')}>
                  {t('privateBeta')}{' '}
                  {tSignUp.rich('requestInvite', {
                    link: (chunks) => (
                      <Link
                        href="/request-invite"
                        className="text-foreground underline underline-offset-2"
                      >
                        {chunks}
                      </Link>
                    ),
                  })}
                </Body>
              )}
              <Body variant="muted">{t('free')}</Body>
              <Body variant="muted">{t('trust')}</Body>
            </div>
          </div>
          <div className="w-full max-w-md lg:justify-self-end">
            {demo ? (
              <LandingDemo day={demo} dayLabel={formatDayLong(parseLocalDate(demo.date), locale)} />
            ) : (
              <LandingShowcase />
            )}
          </div>
        </section>

        <section aria-labelledby="landing-how" className="flex flex-col gap-12 md:gap-16">
          {/* A statement at the hero's size, as on "Made for family kitchens". */}
          <div className="mx-auto max-w-3xl text-center text-balance">
            <Heading variant="h1" as="h2" face="brand" id="landing-how">
              {t('how.title')}
            </Heading>
          </div>
          {/* WebKit drops list semantics from a `list-style: none` list, so the role
              restores "list, 3 items" (as `Ol variant="plain"` does). A raw list
              because the grid's gap is the layout here, which `Ol` owns. */}
          <ol role="list" className="grid list-none gap-10 md:grid-cols-3 md:gap-12">
            {STEPS.map((step, index) => (
              <li key={step}>
                <div className="flex flex-col gap-2">
                  <Body variant="caption">{t('how.step', { number: index + 1 })}</Body>
                  <Heading variant="h4" as="h3" face="brand">
                    {t(`how.${step}.title`)}
                  </Heading>
                  <Body tone="muted">{t(`how.${step}.body`)}</Body>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <LandingFeatures />

        {/* The ending: one line on who made it, as a statement. No second
            call to action (HON-1037). The bottom padding keeps the footer off
            the last line. */}
        <section aria-labelledby="landing-note" className="pb-8 md:pb-16">
          <div className="mx-auto max-w-3xl text-center text-balance">
            <Heading variant="h1" as="h2" face="brand" id="landing-note">
              {/* Two lines by design: the catalog string carries the break. */}
              {t.rich('note.title', { br: () => <br /> })}
              {/* Decoration, in the heading's own ink: the no-break space keeps
                  it on the line of the last word. */}
              {'\u00a0'}
              <Heart
                aria-hidden="true"
                className="inline-block size-7 fill-current align-baseline lg:size-9"
              />
            </Heading>
          </div>
        </section>
      </div>
    </div>
  )
}
