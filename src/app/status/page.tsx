import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react'
import {
  getStatusSnapshot,
  computeOverall,
  type OverallStatus,
  type ProbeStatus,
} from '@/lib/status/probes'
import { Heading, Body } from '@/components/ui/typography'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SUPPORT_EMAIL, SUPPORT_EMAIL_HREF } from '@/lib/support'
import { formatDateTime } from '@/lib/i18n/format-dates'
import { getLocale } from '@/lib/i18n/get-locale'
import type { Locale } from '@/lib/i18n/locales'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta.status')
  return {
    title: t('title'),
    description: t('description'),
  }
}

export const dynamic = 'force-dynamic'

// Card order. Each key's label and description live under
// `status.components.<key>` in the catalogs.
const COMPONENTS = ['ai', 'auth', 'db', 'rateLimit'] as const

export default async function StatusPage() {
  const [snapshot, t, locale] = await Promise.all([
    getStatusSnapshot(),
    getTranslations('status'),
    getLocale(),
  ])
  const overall = computeOverall(snapshot)
  const checkedAt = (iso: string) => t('checkedAt', { time: formatTimestamp(iso, locale) })
  const probeLabels: Record<ProbeStatus, string> = {
    ok: t('probe.ok'),
    down: t('probe.down'),
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <Heading as="h1" variant="h2">
          {t('heading')}
        </Heading>
        <Body variant="muted">{t('intro')}</Body>
      </div>

      {snapshot.incidentMessage ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 flex items-start gap-3 rounded-lg border p-4"
        >
          <AlertCircle className="text-destructive mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <Body variant="small">{t('incidentTitle')}</Body>
            <Body variant="muted">{snapshot.incidentMessage}</Body>
          </div>
        </div>
      ) : null}

      <OverallStatusHeader
        overall={overall}
        label={t(`overall.${overall}.label`)}
        description={t(`overall.${overall}.description`)}
        checkedAt={checkedAt(snapshot.timestamp)}
      />

      <ul className="flex flex-col gap-3">
        {COMPONENTS.map((key) => (
          <li key={key}>
            <ComponentStatusCard
              label={t(`components.${key}.label`)}
              description={t(`components.${key}.description`)}
              status={snapshot[key].status}
              statusLabel={probeLabels[snapshot[key].status]}
              latency={t('latency', { ms: snapshot[key].latencyMs })}
              checkedAt={checkedAt(snapshot[key].checkedAt)}
            />
          </li>
        ))}
      </ul>

      <div className="border-t pt-6">
        <Body variant="muted">
          {t.rich('support', {
            email: SUPPORT_EMAIL,
            mailLink: (chunks) => (
              <a className="underline" href={SUPPORT_EMAIL_HREF}>
                {chunks}
              </a>
            ),
            homeLink: (chunks) => (
              <Link className="underline" href="/">
                {chunks}
              </Link>
            ),
          })}
        </Body>
      </div>
    </div>
  )
}

function OverallStatusHeader({
  overall,
  label,
  description,
  checkedAt,
}: {
  overall: OverallStatus
  label: string
  description: string
  checkedAt: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-4">
      <OverallStatusIcon status={overall} label={label} className="mt-0.5" />
      <div className="flex flex-col gap-1">
        <Body variant="large">{label}</Body>
        <Body variant="muted">{description}</Body>
        <Body variant="caption">{checkedAt}</Body>
      </div>
    </div>
  )
}

function OverallStatusIcon({
  status,
  label,
  className,
}: {
  status: OverallStatus
  label: string
  className?: string
}) {
  const base = `h-5 w-5 shrink-0 ${className ?? ''}`
  if (status === 'ok') {
    return <CheckCircle2 className={`${base} text-success`} aria-label={label} />
  }
  if (status === 'degraded') {
    return <AlertCircle className={`${base} text-warning`} aria-label={label} />
  }
  return <XCircle className={`${base} text-destructive`} aria-label={label} />
}

function ComponentStatusCard({
  label,
  description,
  status,
  statusLabel,
  latency,
  checkedAt,
}: {
  label: string
  description: string
  status: ProbeStatus
  statusLabel: string
  latency: string
  checkedAt: string
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <StatusIcon status={status} label={statusLabel} className="mt-1" />
          <div className="flex flex-1 flex-col gap-1">
            <CardTitle>{label}</CardTitle>
            <Body variant="muted">{description}</Body>
          </div>
          <StatusBadge status={status} label={statusLabel} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Body variant="caption">{latency}</Body>
          <Body variant="caption">{checkedAt}</Body>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status, label }: { status: ProbeStatus; label: string }) {
  if (status === 'ok') return <Badge variant="secondary">{label}</Badge>
  return <Badge variant="destructive">{label}</Badge>
}

function StatusIcon({
  status,
  label,
  className,
}: {
  status: ProbeStatus
  label: string
  className?: string
}) {
  if (status === 'ok') {
    return (
      <CheckCircle2
        className={`text-success h-5 w-5 shrink-0 ${className ?? ''}`}
        aria-label={label}
      />
    )
  }
  return (
    <XCircle
      className={`text-destructive h-5 w-5 shrink-0 ${className ?? ''}`}
      aria-label={label}
    />
  )
}

/**
 * Probe timestamps are UTC instants rendered for an anonymous audience with no
 * household timezone, so the time stays in UTC (the catalog string says so) and
 * only the language and format follow the locale.
 */
function formatTimestamp(iso: string, locale: Locale): string {
  try {
    return formatDateTime(new Date(iso), locale, { timeZone: 'UTC' })
  } catch {
    // `Intl.DateTimeFormat#format` throws a RangeError on an invalid date.
    return iso
  }
}
