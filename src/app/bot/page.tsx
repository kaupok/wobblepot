import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Body, Code, Heading, Li, Ul } from '@/components/ui/typography'
import { WOBBLEPOT_BOT_TOKEN, WOBBLEPOT_BOT_USER_AGENT } from '@/lib/bot-identity'
import { PRIVACY_EMAIL, PRIVACY_EMAIL_HREF } from '@/lib/support'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta.bot')
  return {
    title: t('title'),
    description: t('description'),
  }
}

// `<code>` in the `bot` catalog strings: file names, robots tokens and rules.
const code = (chunks: ReactNode) => <Code>{chunks}</Code>

export default async function BotPage() {
  const t = await getTranslations('bot')

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="flex flex-col gap-4">
        <Heading>{t('heading')}</Heading>
        <Body variant="lead">{t('lead')}</Body>
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <Heading variant="h2">{t('userAgent.heading')}</Heading>
        <Body>{t('userAgent.body')}</Body>
        <Body>
          <Code>{WOBBLEPOT_BOT_USER_AGENT}</Code>
        </Body>
        <Body variant="muted">
          {t.rich('userAgent.robotsToken', { token: WOBBLEPOT_BOT_TOKEN, code })}
        </Body>
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <Heading variant="h2">{t('does.heading')}</Heading>
        <Ul>
          <Li>
            <Body>{t('does.fetch')}</Body>
          </Li>
          <Li>
            <Body>{t('does.extract')}</Body>
          </Li>
        </Ul>
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <Heading variant="h2">{t('doesNot.heading')}</Heading>
        <Ul>
          <Li>
            <Body>{t('doesNot.crawl')}</Body>
          </Li>
          <Li>
            <Body>{t('doesNot.index')}</Body>
          </Li>
          <Li>
            <Body>{t('doesNot.schedule')}</Body>
          </Li>
        </Ul>
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <Heading variant="h2">{t('respect.heading')}</Heading>
        <Ul>
          <Li>
            <Body>{t.rich('respect.robots', { token: WOBBLEPOT_BOT_TOKEN, code })}</Body>
          </Li>
          <Li>
            <Body>{t.rich('respect.cache', { code })}</Body>
          </Li>
          <Li>
            <Body>{t('respect.disallow')}</Body>
          </Li>
        </Ul>
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <Heading variant="h2">{t('contact.heading')}</Heading>
        <Body>
          {t.rich('contact.body', {
            email: PRIVACY_EMAIL,
            token: WOBBLEPOT_BOT_TOKEN,
            code,
            link: (chunks) => (
              <a className="underline" href={PRIVACY_EMAIL_HREF}>
                {chunks}
              </a>
            ),
          })}
        </Body>
      </div>
    </div>
  )
}
