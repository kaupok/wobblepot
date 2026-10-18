'use client'

import type { ReactNode } from 'react'
import { Plug, Sparkles } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Body, Heading } from '@/components/ui/typography'
import { formatDayShort } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'

/**
 * The kitchen screen's dinners: the week strip's Friday to Sunday
 * (`LandingWeek`), so the page names one week everywhere. The chat asks about
 * Friday's.
 */
const SCREEN_DAYS = [
  { key: 'fri', index: 4, minutes: 50 },
  { key: 'sat', index: 5, minutes: 90 },
  { key: 'sun', index: 6, minutes: 80 },
] as const

/** A Monday, as in `LandingWeek`, so day `i` is `WEEK_START` plus `i` days. */
const WEEK_START = Date.UTC(2026, 0, 5)
const DAY_MS = 24 * 60 * 60 * 1000

const VIGNETTES = ['assistant', 'screen'] as const
type Vignette = (typeof VIGNETTES)[number]

// Tilted against each other, as the other tiles' vignettes are.
const TILTS: Record<Vignette, string> = {
  assistant: '-rotate-1',
  screen: 'rotate-1',
}

/**
 * The fifth point of "Made for family kitchens": the MCP server and the
 * read-only API key (docs/MCP_SERVER.md, docs/API.md). One tile across both
 * columns from `md`, on the neutral `mist` tile, so it reads as the close of
 * the list rather than a fifth colour. Two vignettes: an assistant that reads
 * the meal plan and, with the user's permission, marks an item bought; and a
 * kitchen screen that shows the week through a read-only key.
 *
 * Renders the `<li>`: `LandingFeatures` puts it last in its list.
 */
export function LandingConnect() {
  const t = useTranslations('landing.why.connect')

  return (
    <li
      data-landing-tile="mist"
      className="flex flex-col gap-7 overflow-hidden rounded-3xl px-5 pt-7 pb-8 md:col-span-2 md:px-10 md:pt-10 md:pb-10"
    >
      <div className="flex max-w-2xl flex-col gap-2 text-balance">
        <Heading variant="h3" face="brand">
          {t('title')}
        </Heading>
        <Body>{t('body')}</Body>
      </div>
      <div className="grid gap-7 md:grid-cols-2 md:gap-10">
        {VIGNETTES.map((vignette) => (
          <figure key={vignette} data-testid={`landing-vignette-${vignette}`} className="min-w-0">
            <div inert className={TILTS[vignette]}>
              {vignette === 'assistant' ? <AssistantVignette /> : <ScreenVignette />}
            </div>
            {/* Outside the inert part, which assistive tech skips. */}
            <figcaption className="sr-only">{t(`${vignette}.caption`)}</figcaption>
          </figure>
        ))}
      </div>
    </li>
  )
}

/** The app's neutral card, with no border: on the tile the paper is the edge. */
function Surface({ children }: { children: ReactNode }) {
  return (
    <Card size="sm" bordered={false}>
      <CardContent className="py-4">{children}</CardContent>
    </Card>
  )
}

/** The assistant's call to Wobblepot, as a chat app draws a tool call. */
function ToolCall({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 self-start">
      <Plug aria-hidden="true" className="text-muted-foreground size-3.5" />
      <Body variant="caption">{children}</Body>
    </div>
  )
}

function Question({ children }: { children: ReactNode }) {
  return (
    <div className="bg-foreground text-background max-w-4/5 self-end rounded-2xl rounded-br-sm px-4 py-2.5">
      <Body variant="paragraph">{children}</Body>
    </div>
  )
}

function Answer({ children }: { children: ReactNode }) {
  return (
    <div className="bg-muted flex max-w-11/12 items-start gap-2.5 self-start rounded-2xl rounded-bl-sm px-4 py-3">
      <Sparkles aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <Body variant="paragraph">{children}</Body>
    </div>
  )
}

/**
 * Two exchanges with an assistant: a read (Friday's dinner and what is still
 * to buy) and a write (the mozzarella bought), each after the tool call that
 * served it, so the picture says "it reads your plan and, if you allow it,
 * changes it".
 */
function AssistantVignette() {
  const t = useTranslations('landing.why.connect.assistant')

  return (
    <Surface>
      <div className="flex flex-col gap-3">
        <Question>{t('question')}</Question>
        <ToolCall>{t('readPlan')}</ToolCall>
        <Answer>{t('answer')}</Answer>
        <Question>{t('bought')}</Question>
        <ToolCall>{t('markBought')}</ToolCall>
        <Answer>{t('done')}</Answer>
      </div>
    </Surface>
  )
}

/**
 * A screen on the kitchen wall, as a dashboard draws the read-only API's
 * answer: the next three dinners, then what is left to buy after the chat.
 */
function ScreenVignette() {
  const t = useTranslations('landing.why.connect.screen')
  const tWeek = useTranslations('landing.week')
  const locale = useLocale() as Locale

  return (
    <div className="bg-foreground rounded-3xl p-2.5">
      <Surface>
        <div className="flex flex-col gap-4">
          <Heading variant="section" as="p">
            {t('dinners')}
          </Heading>
          <ul role="list" className="flex list-none flex-col divide-y">
            {SCREEN_DAYS.map((day) => (
              <li key={day.key} className="flex items-baseline gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="w-10 shrink-0">
                  <Body variant="figure-small" tone="muted">
                    {formatDayShort(new Date(WEEK_START + day.index * DAY_MS), locale, {
                      timeZone: 'UTC',
                    })}
                  </Body>
                </div>
                <div className="min-w-0 flex-1">
                  <Body variant="paragraph">{tWeek(`meals.${day.key}`)}</Body>
                </div>
                <Body variant="figure-small" tone="muted">
                  {tWeek('minutes', { count: day.minutes })}
                </Body>
              </li>
            ))}
          </ul>
          <div className="bg-muted flex items-baseline justify-between gap-3 rounded-xl px-3 py-2.5">
            <Body variant="figure-small">{t('toBuy')}</Body>
            <Body variant="paragraph">{t('basil')}</Body>
          </div>
        </div>
      </Surface>
    </div>
  )
}
