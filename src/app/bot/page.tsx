import type { Metadata } from 'next'
import { Body, Code, Heading, Li, Ul } from '@/components/ui/typography'

export const metadata: Metadata = {
  title: 'Honkadori-Bot',
  description:
    'About Honkadori-Bot — the user-agent Honkadori sends when fetching recipe URLs you explicitly submit via the import feature.',
}

export default function BotPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="flex flex-col gap-4">
        <Heading>About Honkadori-Bot</Heading>
        <Body variant="lead">
          Honkadori-Bot fetches recipe pages that users explicitly submit through the recipe import
          feature. It is not a crawler.
        </Body>
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <Heading variant="h2">User-agent</Heading>
        <Body>The bot identifies itself with the following User-Agent string:</Body>
        <Body>
          <Code>Honkadori-Bot/1.0 (+https://honkadori.xyz/bot)</Code>
        </Body>
        <Body variant="muted">
          For <Code>robots.txt</Code> matching, the token is <Code>Honkadori-Bot/1.0</Code>.
        </Body>
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <Heading variant="h2">What it does</Heading>
        <Ul>
          <Li>
            <Body>
              Fetches recipe pages that a signed-in user has pasted into the recipe import field.
            </Body>
          </Li>
          <Li>
            <Body>
              Extracts recipe data (ingredients, instructions, prep/cook time) for that user.
            </Body>
          </Li>
        </Ul>
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <Heading variant="h2">What it does not do</Heading>
        <Ul>
          <Li>
            <Body>No crawling. It never follows links off the submitted page.</Body>
          </Li>
          <Li>
            <Body>No indexing. It does not build a search index of your content.</Body>
          </Li>
          <Li>
            <Body>
              No scheduled fetches. It only fetches when a user initiates an import and never
              re-fetches the same URL on a schedule.
            </Body>
          </Li>
        </Ul>
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <Heading variant="h2">Respecting your site</Heading>
        <Ul>
          <Li>
            <Body>
              Honkadori-Bot honours <Code>robots.txt</Code>. If your rules disallow{' '}
              <Code>Honkadori-Bot/1.0</Code> (or <Code>*</Code>) for a URL, we will not fetch it.
            </Body>
          </Li>
          <Li>
            <Body>
              We cache <Code>robots.txt</Code> decisions per origin for 24 hours to avoid repeated
              requests.
            </Body>
          </Li>
          <Li>
            <Body>
              Users who hit a disallow see a message explaining they can paste the recipe text
              directly instead.
            </Body>
          </Li>
        </Ul>
      </div>

      <div className="mt-10 flex flex-col gap-3">
        <Heading variant="h2">Contact</Heading>
        <Body>
          If you want us to stop (or start) fetching your site, or you have questions about how
          Honkadori handles content, email{' '}
          <a className="underline" href="mailto:privacy@honkadori.xyz">
            privacy@honkadori.xyz
          </a>
          . The quickest way to deny us is to add a <Code>Disallow</Code> rule for{' '}
          <Code>Honkadori-Bot/1.0</Code> in your <Code>robots.txt</Code>.
        </Body>
      </div>
    </div>
  )
}
