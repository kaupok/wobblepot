import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Body, Heading } from '@/components/ui/typography'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { POLICY_LAST_UPDATED_DISPLAY } from '@/lib/consent'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta.legal.subprocessors')
  return {
    title: t('title'),
    description: t('description'),
  }
}

// "Last updated" derives from POLICY_LAST_UPDATED (src/lib/consent.ts) — a
// subprocessor change is a material policy change, so the two move together.
const LAST_UPDATED = POLICY_LAST_UPDATED_DISPLAY

interface Processor {
  name: string
  role: string
  dataCategories: string
  region: string
  transferBasis: string
  privacyUrl: string
  dpaUrl: string
  note?: string
}

/**
 * Source of truth: `compliance/README.md` (DPA table, signed under Honkadori
 * OÜ — HON-459). LOUD RULE: when any new vendor that processes user data is
 * added anywhere in the codebase (checkout webhooks, email providers,
 * analytics, …), add a row here AND update `compliance/README.md` in the
 * same PR. The privacy policy (`../page.tsx`) names the vendors in prose and
 * links here — keep the two in sync. Region strings are exact on purpose —
 * "EU (Frankfurt)", not "Europe".
 */
const PROCESSORS: Processor[] = [
  {
    name: 'Anthropic, PBC',
    role: 'AI meal planning (LLM)',
    dataCategories: 'Prompts (household preferences, allergens, dietary data) and AI output',
    region: 'US',
    transferBasis: 'EU SCCs Module 2 + UK Addendum + EU-US DPF',
    privacyUrl: 'https://www.anthropic.com/legal/privacy',
    dpaUrl: 'https://www.anthropic.com/legal/data-processing-addendum',
  },
  {
    name: 'Resend (Plus Five Five, Inc.)',
    role: 'Transactional email',
    dataCategories: 'Email address, message metadata',
    region: 'US',
    transferBasis: 'EU SCCs Module 2 + UK SCCs + EU-US DPF',
    privacyUrl: 'https://resend.com/legal/privacy-policy',
    dpaUrl: 'https://resend.com/legal/dpa',
  },
  {
    name: 'Vercel Inc.',
    role: 'Hosting',
    dataCategories: 'Request metadata, application logs',
    region: 'US/EU',
    transferBasis: 'EU SCCs (2021) Module 2 + UK IDTA',
    privacyUrl: 'https://vercel.com/legal/privacy-policy',
    dpaUrl: 'https://vercel.com/legal/dpa',
  },
  {
    name: 'Neon (a Databricks company)',
    role: 'Database',
    dataCategories: 'All user records',
    region: 'EU (Frankfurt); importer Databricks, Inc. (US)',
    transferBasis: 'EU SCCs Modules 2/3 + UK Addendum + Swiss addendum',
    privacyUrl: 'https://neon.com/privacy-policy',
    dpaUrl: 'https://neon.com/dpa',
  },
  {
    name: 'PostHog, Inc.',
    role: 'Product analytics + error tracking',
    dataCategories: 'Usage events, device info',
    region: 'EU (Frankfurt); processor PostHog, Inc. (US)',
    transferBasis: 'EU-US DPF + EU SCCs Module 2 + UK IDTA + Swiss addendum',
    privacyUrl: 'https://posthog.com/privacy',
    dpaUrl: 'https://posthog.com/dpa',
    note: 'Active only after you accept analytics cookies.',
  },
]

export default function SubprocessorsPage() {
  return (
    <>
      <div className="flex flex-col gap-4">
        <Heading>Subprocessors</Heading>
        <Body variant="muted">Last updated: {LAST_UPDATED}</Body>
        <Body variant="lead">
          These are the vendors that process personal data on Wobblepot&apos;s behalf. All five
          involve a transfer to the United States, covered by the safeguards listed for each. We
          have a data processing agreement with every one of them.
        </Body>
      </div>

      <div className="mt-10">
        <Table containerLabel="Subprocessors">
          <TableHeader>
            <TableRow>
              <TableHead>Processor</TableHead>
              <TableHead className="whitespace-normal">Role + data</TableHead>
              <TableHead className="whitespace-normal">Region</TableHead>
              <TableHead className="whitespace-normal">Transfer safeguards</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PROCESSORS.map((p) => (
              <TableRow key={p.name}>
                <TableHead scope="row" className="align-top font-medium whitespace-normal">
                  {p.name}
                  {/* aria-labels keep the 10 links distinguishable in a
                      screen-reader links list (WCAG 2.4.4) while retaining the
                      visible text in the accessible name (WCAG 2.5.3). */}
                  <span className="block font-normal">
                    <a
                      className="underline"
                      href={p.privacyUrl}
                      aria-label={`${p.name} privacy policy`}
                    >
                      Privacy
                    </a>
                    {' · '}
                    <a className="underline" href={p.dpaUrl} aria-label={`${p.name} DPA`}>
                      DPA
                    </a>
                  </span>
                </TableHead>
                <TableCell className="align-top whitespace-normal">
                  {p.role} — {p.dataCategories}
                  {p.note ? ` ${p.note}` : ''}
                </TableCell>
                <TableCell className="align-top whitespace-normal">{p.region}</TableCell>
                <TableCell className="align-top whitespace-normal">{p.transferBasis}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <Body variant="muted">
          Each row links to the vendor&apos;s privacy policy and data processing agreement. When
          this list changes materially, the privacy policy&apos;s &ldquo;Last updated&rdquo; date is
          bumped with it.
        </Body>
        <Body>
          <Link className="underline" href="/privacy">
            Back to the privacy policy
          </Link>
        </Body>
      </div>
    </>
  )
}
