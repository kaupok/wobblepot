import Link from 'next/link'
import { Heart } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Body, Heading } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { LandingDeck } from '@/components/landing/LandingDeck'
import { LandingFeatures } from '@/components/landing/LandingFeatures'
import {
  ShoppingVignette,
  TableVignette,
  WeekVignette,
} from '@/components/landing/LandingStepVignettes'
import { LandingWeek } from '@/components/landing/LandingWeek'
import { displayFont } from '@/components/landing/display-font'
import { formatDayLong } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import type { DemoDay } from '@/lib/landing/load-demo-day'
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { cn } from '@/lib/utils'

const STEPS = ['table', 'week', 'shop'] as const

/** The static example day's weekday, Monday as 0: the showcase's Thursday. */
const SHOWCASE_DAY_INDEX = 3
/** The showcase dinner's minutes, for the week strip when there is no demo. */
const SHOWCASE_DINNER_MINUTES = 25

interface LandingPageProps {
  /** `invite_code_required`: sign-up needs a code, so the call to action says so. */
  inviteRequired: boolean
  locale: Locale
  /**
   * Today's three library meals, each opening the cook view (`loadDemoDay`),
   * or null when the library cannot fill a day, in which case the static
   * example day stands in.
   */
  demo: DemoDay | null
}

/**
 * The signed-out home page (HON-1116). A centred hero, with
 * tonight's dinner in front of breakfast and lunch and the rest of the week as
 * a strip of days under it. The three steps sit on a grey band, each above a
 * simple picture of that step, and the four points are a 2×2 grid of tiles,
 * each with its vignette (`LandingFeatures`). The page ends on the maker's line.
 *
 * The deck and the week strip follow the demo day: today's weekday is
 * tonight, and every card opens its meal in the cook view (`LandingDeck`).
 *
 * The call to action is in the hero, and on phones once more above the
 * closing line: from `md` the floating header keeps "Sign up" on screen, but
 * below `md` the scrolled header folds to an icon, so a phone reader at the
 * end of the page would have no sign-up control in sight (HON-1060).
 *
 * Not `<main>`: the root layout's `<main id="main-content">` is the page
 * landmark (HON-820). The page's own headings are set in the display face
 * (`face="brand"`, HON-1043); the app components it draws keep Geist, because
 * they show the product.
 */
export async function LandingPage({ inviteRequired, locale, demo }: LandingPageProps) {
  const [t, tSignUp] = await Promise.all([
    getTranslations('landing'),
    getTranslations('auth.signUp'),
  ])
  const dinner = demo?.meals.find((entry) => entry.mealType === 'dinner')
  const today = demo && dinner ? parseLocalDate(demo.date) : null
  // Monday as 0, as the week strip counts.
  const tonightIndex = today ? (today.getDay() + 6) % 7 : SHOWCASE_DAY_INDEX
  const dayLabel = today ? formatDayLong(today, locale) : t('showcase.day')
  const tonight = dinner
    ? { name: dinner.meal.name, minutes: dinner.meal.timeMinutes ?? null }
    : { name: t('showcase.dinner.name'), minutes: SHOWCASE_DINNER_MINUTES }

  return (
    <div className={cn('w-full px-4 py-8 md:py-16', displayFont.variable)}>
      <div className="flex flex-col gap-20 md:gap-32">
        {/* Hero. The gutter is pulled back (`-mx-4 px-4`) and the section
            clips sideways, so the cards behind tonight's dinner and the week
            strip run to the screen's edge on a phone rather than stopping at
            the column. */}
        <section className="-mx-4 flex flex-col items-center gap-8 overflow-x-clip px-4 text-center md:gap-10">
          <div className="flex max-w-4xl flex-col items-center gap-5 text-balance">
            <Heading variant="hero" face="brand">
              {/* The catalog string breaks after the first sentence. */}
              {t.rich('headline', { br: () => <br /> })}
            </Heading>
            <div className="max-w-2xl">
              <Body variant="lead">{t('sub')}</Body>
            </div>
          </div>

          <div className="flex w-full max-w-2xl flex-col items-center gap-3 text-balance">
            <Button asChild size="lg" className="w-full md:w-auto">
              <Link href="/sign-up">{t('cta')}</Link>
            </Button>
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
            {/* One line, so the deck starts above the fold. */}
            <Body variant="muted">{t('ctaNote')}</Body>
          </div>

          <LandingDeck day={dinner ? demo : null} dayLabel={dayLabel} />

          <LandingWeek locale={locale} tonightIndex={tonightIndex} tonight={tonight} />
        </section>

        <section
          aria-labelledby="landing-how"
          className="bg-muted flex flex-col gap-8 rounded-3xl px-5 py-7 md:px-12 md:py-11"
        >
          <Heading variant="h3" as="h2" face="brand" id="landing-how">
            {t('how.title')}
          </Heading>
          {/* The role restores list semantics WebKit drops from a
              `list-style: none` list, as on the live page. */}
          {/* From `md`, each step spans two rows of a subgrid, so the
              pictures share one height and the step titles line up. */}
          <ol role="list" className="grid list-none gap-10 md:grid-cols-3 md:gap-x-8 md:gap-y-5">
            {STEPS.map((step, index) => (
              <li
                key={step}
                className="flex flex-col gap-5 md:row-span-2 md:grid md:grid-rows-subgrid"
              >
                <StepPicture step={step} />
                <div className="flex items-start gap-4">
                  {/* The numeral in the display face, on a disc in the
                      foreground's ink; the sr-only line names the step. */}
                  <div
                    aria-hidden="true"
                    className="bg-foreground text-background flex size-10 shrink-0 items-center justify-center rounded-full"
                  >
                    <Heading variant="h4" as="span" face="brand">
                      {index + 1}
                    </Heading>
                  </div>
                  <div className="flex flex-col gap-1.5 pt-1.5">
                    <span className="sr-only">{t('how.step', { number: index + 1 })}</span>
                    <Heading variant="h4" as="h3" face="brand">
                      {t(`how.${step}.title`)}
                    </Heading>
                    {/* The default ink: muted text on the grey band is under
                        the 4.5:1 contrast floor. */}
                    <Body>{t(`how.${step}.body`)}</Body>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <LandingFeatures />

        {/* Phones only, as on the live page (HON-1060). The hero's one line
            under the call to action is the page's only small print. */}
        <div className="mx-auto flex max-w-3xl flex-col gap-6 text-center text-balance md:hidden">
          <Body variant="lead">{t('close.line')}</Body>
          <Button asChild size="lg" className="w-full">
            <Link href="/sign-up">{t('cta')}</Link>
          </Button>
        </div>

        <section aria-labelledby="landing-note" className="pb-8 md:pb-16">
          <div className="mx-auto max-w-3xl text-center text-balance">
            <Heading variant="h1" as="h2" face="brand" id="landing-note">
              {t.rich('note.title', { br: () => <br /> })}
              {' '}
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

/** A picture of each step, three rows on a white panel. */
function StepPicture({ step }: { step: (typeof STEPS)[number] }) {
  return (
    <div inert className="bg-background flex flex-col justify-center rounded-2xl px-5 py-2">
      {step === 'table' && <TableVignette />}
      {step === 'week' && <WeekVignette />}
      {step === 'shop' && <ShoppingVignette />}
    </div>
  )
}
