import Link from 'next/link'
import { Check, Heart } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Body, Heading } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import {
  HouseholdVignette,
  type LandingPoint,
  LandingVignette,
} from '@/components/landing/LandingFeatures'
import { ShowcaseMealCard } from '@/components/landing/LandingShowcase'
import { displayFont } from '@/components/landing/display-font'
import { formatDayShort } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import { cn } from '@/lib/utils'
import { ShoppingVignette } from './ShoppingVignette'

const STEPS = ['table', 'week', 'shop'] as const

// The live page's four points, in its order. Here, not imported: a server
// component gets a client module's constants as references, not values.
const POINTS: readonly LandingPoint[] = ['pantry', 'imagine', 'kids', 'cook']

/**
 * Copy that only this preview uses, in English. It moves to the catalogs
 * (en and et) when the direction replaces `LandingPage`.
 */
const COPY = {
  tonight: 'Tonight',
  tonightsDinner: "Tonight's dinner",
  restOfWeek: 'The rest of the week',
  cooked: 'Cooked',
  minutes: (n: number) => `${n} min`,
}

/**
 * The example week around the showcase dinner: Monday to Wednesday cooked,
 * Thursday tonight (`landing.showcase.dinner`, so the strip and the front card
 * name the same meal), the rest to come. Example data, in English until the
 * catalogs carry it.
 */
const WEEK: ReadonlyArray<{
  name: string | null
  minutes: number
  state: 'cooked' | 'tonight' | 'planned'
}> = [
  { name: 'Spaghetti bolognese', minutes: 35, state: 'cooked' },
  { name: 'Chicken and rice traybake', minutes: 45, state: 'cooked' },
  { name: 'Lentil soup with bread', minutes: 40, state: 'cooked' },
  { name: null, minutes: 25, state: 'tonight' },
  { name: 'Homemade pizza', minutes: 50, state: 'planned' },
  { name: 'Beef stew with potatoes', minutes: 90, state: 'planned' },
  { name: 'Roast chicken with vegetables', minutes: 80, state: 'planned' },
]

/** A Monday, so index 0 is Monday's short name in the visitor's language. */
const WEEK_START = Date.UTC(2026, 0, 5)
const DAY_MS = 24 * 60 * 60 * 1000

interface LandingB1Props {
  inviteRequired: boolean
  locale: Locale
}

/**
 * Landing direction B1: B's centred hero, with tonight's dinner in front of
 * breakfast and lunch, then the rest of the week as a strip of days. The
 * three steps sit on a grey band, each above a picture of that step in the
 * app, and the four points are a 2×2 grid of tiles, each with its vignette.
 * The ending is the live page's: the phone-only call to action (HON-1060) and
 * the maker's line.
 *
 * The headline is a raw `h1` at a size the type scale does not have yet. The
 * shipped version needs a `Heading` variant for it.
 */
export async function LandingB1({ inviteRequired, locale }: LandingB1Props) {
  const [t, tSignUp] = await Promise.all([
    getTranslations('landing'),
    getTranslations('auth.signUp'),
  ])

  return (
    <div className={cn('w-full px-4 py-8 md:py-16', displayFont.variable)}>
      <div className="flex flex-col gap-20 md:gap-32">
        {/* Hero. Clipped sideways because the cards behind tonight's dinner
            reach past the column, and past the screen on a phone. */}
        <section className="flex flex-col items-center gap-8 overflow-x-clip text-center md:gap-10">
          <div className="flex max-w-4xl flex-col items-center gap-5 text-balance">
            <h1 className="font-display text-5xl leading-none font-bold tracking-tight md:text-7xl lg:text-8xl">
              {t('headline')}
            </h1>
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
            <Body variant="muted">{t('free')}</Body>
            <Body variant="muted">{t('trust')}</Body>
          </div>

          <MealDeck label={`${t('showcase.day')} · ${COPY.tonightsDinner}`} />

          <WeekStrip locale={locale} tonightName={t('showcase.dinner.name')} />
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
          <ol role="list" className="grid list-none gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, index) => (
              <li key={step} className="flex flex-col gap-5">
                <StepPicture step={step} />
                <div className="flex items-start gap-4">
                  <span
                    aria-hidden="true"
                    className="bg-foreground font-display text-background flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-bold"
                  >
                    {index + 1}
                  </span>
                  <div className="flex flex-col gap-1.5 pt-1.5">
                    <span className="sr-only">{t('how.step', { number: index + 1 })}</span>
                    <Heading variant="h4" as="h3">
                      {t(`how.${step}.title`)}
                    </Heading>
                    <Body tone="muted">{t(`how.${step}.body`)}</Body>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="landing-why" className="flex flex-col gap-10 md:gap-12">
          <div className="mx-auto max-w-3xl text-center text-balance">
            <Heading variant="h1" as="h2" face="brand" id="landing-why">
              {t('why.title')}
            </Heading>
          </div>
          <ul role="list" className="grid list-none gap-5 md:grid-cols-2">
            {POINTS.map((point) => (
              <li
                key={point}
                className="bg-muted flex flex-col gap-7 overflow-hidden rounded-3xl px-5 pt-7 pb-8 md:px-10 md:pt-10 md:pb-10"
              >
                <div className="flex flex-col gap-2 text-balance">
                  <Heading variant="h3" face="brand">
                    {t(`why.${point}.title`)}
                  </Heading>
                  <Body tone="muted">{t(`why.${point}.body`)}</Body>
                </div>
                <div className="mx-auto w-full max-w-md">
                  <LandingVignette point={point} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Phones only, as on the live page (HON-1060). */}
        <div className="md:hidden">
          <div className="mx-auto flex max-w-3xl flex-col gap-6 text-center text-balance">
            <Body variant="lead">{t('close.line')}</Body>
            <Button asChild size="lg" className="w-full">
              <Link href="/sign-up">{t('cta')}</Link>
            </Button>
          </div>
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

/**
 * Tonight's dinner in front, breakfast and lunch tilted behind it on either
 * side. The cards behind are decoration (`inert`); the front card is the one
 * a screen reader meets.
 */
function MealDeck({ label }: { label: string }) {
  return (
    <figure className="relative w-full max-w-md pt-16 pb-10 text-left md:pt-10 md:pb-16">
      <figcaption className="absolute inset-x-0 top-0 text-center">
        <Heading variant="section" as="p">
          {label}
        </Heading>
      </figcaption>
      <div inert className="absolute top-8 -left-20 w-64 -rotate-6 md:top-20 md:-left-64 md:w-80">
        <ShowcaseMealCard meal="breakfast" description={false} />
      </div>
      <div inert className="absolute top-8 -right-20 w-64 rotate-6 md:top-20 md:-right-64 md:w-80">
        <ShowcaseMealCard meal="lunch" description={false} />
      </div>
      <div className="relative z-10 rounded-xl shadow-xl">
        <ShowcaseMealCard meal="dinner" />
      </div>
    </figure>
  )
}

/**
 * Monday to Sunday under the deck. A row of seven from `md`; on a phone a
 * strip that scrolls sideways, focusable so a keyboard can scroll it.
 */
function WeekStrip({ locale, tonightName }: { locale: Locale; tonightName: string }) {
  return (
    <div className="flex w-full max-w-6xl flex-col gap-3 text-left">
      <p className="text-muted-foreground text-center text-sm font-semibold">{COPY.restOfWeek}</p>
      <div
        role="region"
        aria-label={COPY.restOfWeek}
        tabIndex={0}
        className="overflow-x-auto pb-1 md:overflow-visible"
      >
        <ol role="list" className="flex list-none gap-2 md:grid md:grid-cols-7">
          {WEEK.map((day, index) => {
            const dayName = formatDayShort(new Date(WEEK_START + index * DAY_MS), locale, {
              timeZone: 'UTC',
            })
            const tonight = day.state === 'tonight'
            const cooked = day.state === 'cooked'
            return (
              <li
                key={dayName}
                className={cn(
                  'flex min-h-24 w-32 shrink-0 flex-col gap-1.5 rounded-xl border p-3 md:w-auto',
                  tonight && 'border-foreground bg-foreground text-background',
                  cooked && 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex items-center justify-between text-xs font-semibold',
                    !tonight && 'text-muted-foreground',
                  )}
                >
                  {tonight ? `${dayName} · ${COPY.tonight}` : dayName}
                  {cooked && <Check aria-label={COPY.cooked} className="size-3.5" />}
                </span>
                <span
                  className={cn('text-sm leading-snug', tonight ? 'font-semibold' : 'font-medium')}
                >
                  {day.name ?? tonightName}
                </span>
                <span className={cn('mt-auto text-xs', !tonight && 'text-muted-foreground')}>
                  {COPY.minutes(day.minutes)}
                </span>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

/** A picture of each step in the app, on a white panel cut at a fixed height. */
function StepPicture({ step }: { step: (typeof STEPS)[number] }) {
  return (
    <div inert className="bg-background h-72 overflow-hidden rounded-2xl p-4">
      {step === 'table' && <HouseholdVignette />}
      {step === 'week' && (
        <div className="flex flex-col gap-2">
          <ShowcaseMealCard meal="breakfast" description={false} />
          <ShowcaseMealCard meal="lunch" description={false} />
        </div>
      )}
      {step === 'shop' && <ShoppingVignette />}
    </div>
  )
}
