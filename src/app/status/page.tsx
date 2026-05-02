import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react'
import {
  getStatusSnapshot,
  computeOverall,
  type OverallStatus,
  type ProbeResult,
  type ProbeStatus,
} from '@/lib/status/probes'
import { Heading, Body } from '@/components/ui/typography'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SUPPORT_EMAIL, SUPPORT_EMAIL_HREF } from '@/lib/support'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta.status')
  return {
    title: t('title'),
    description: t('description'),
  }
}

export const dynamic = 'force-dynamic'

const COMPONENTS: { key: 'db' | 'auth' | 'ai'; label: string; description: string }[] = [
  { key: 'ai', label: 'AI pipeline', description: 'Meal plan generation via Claude' },
  { key: 'auth', label: 'Auth', description: 'Sign-in and session management' },
  { key: 'db', label: 'Database', description: 'Primary PostgreSQL store' },
]

export default async function StatusPage() {
  const snapshot = await getStatusSnapshot()
  const overall = computeOverall(snapshot)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <Heading variant="h2">Status</Heading>
        <Body variant="muted">Live health of Honkadori&apos;s core services.</Body>
      </div>

      {snapshot.incidentMessage ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 flex items-start gap-3 rounded-lg border p-4"
        >
          <AlertCircle className="text-destructive mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <Body variant="small">Incident in progress</Body>
            <Body variant="muted">{snapshot.incidentMessage}</Body>
          </div>
        </div>
      ) : null}

      <OverallStatusHeader overall={overall} timestamp={snapshot.timestamp} />

      <ul className="flex flex-col gap-3">
        {COMPONENTS.map(({ key, label, description }) => (
          <li key={key}>
            <ComponentStatusCard label={label} description={description} result={snapshot[key]} />
          </li>
        ))}
      </ul>

      <div className="border-t pt-6">
        <Body variant="muted">
          Something looks wrong? Email us at{' '}
          <a className="underline" href={SUPPORT_EMAIL_HREF}>
            {SUPPORT_EMAIL}
          </a>{' '}
          or return to the{' '}
          <Link className="underline" href="/">
            home page
          </Link>
          .
        </Body>
      </div>
    </div>
  )
}

function OverallStatusHeader({
  overall,
  timestamp,
}: {
  overall: OverallStatus
  timestamp: string
}) {
  const copy: Record<OverallStatus, { label: string; description: string }> = {
    ok: {
      label: 'All systems operational',
      description: 'Every component is responding normally.',
    },
    degraded: {
      label: 'Partial outage',
      description: 'One or more components are reporting issues. Details below.',
    },
    down: {
      label: 'Major outage',
      description: 'All probed components are currently failing.',
    },
  }
  const { label, description } = copy[overall]

  return (
    <div className="flex items-start gap-3 rounded-lg border p-4">
      <OverallStatusIcon status={overall} className="mt-0.5" />
      <div className="flex flex-col gap-1">
        <Body variant="large">{label}</Body>
        <Body variant="muted">{description}</Body>
        <Body variant="caption">Checked at {formatTimestamp(timestamp)}</Body>
      </div>
    </div>
  )
}

function OverallStatusIcon({ status, className }: { status: OverallStatus; className?: string }) {
  const base = `h-5 w-5 shrink-0 ${className ?? ''}`
  if (status === 'ok') {
    return (
      <CheckCircle2
        className={`${base} text-green-600 dark:text-green-500`}
        aria-label="All systems operational"
      />
    )
  }
  if (status === 'degraded') {
    return (
      <AlertCircle
        className={`${base} text-amber-600 dark:text-amber-500`}
        aria-label="Partial outage"
      />
    )
  }
  return <XCircle className={`${base} text-destructive`} aria-label="Major outage" />
}

function ComponentStatusCard({
  label,
  description,
  result,
}: {
  label: string
  description: string
  result: ProbeResult
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <StatusIcon status={result.status} className="mt-1" />
          <div className="flex flex-1 flex-col gap-1">
            <CardTitle>{label}</CardTitle>
            <Body variant="muted">{description}</Body>
          </div>
          <StatusBadge status={result.status} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Body variant="caption">Latency: {result.latencyMs}ms</Body>
          <Body variant="caption">Checked at {formatTimestamp(result.checkedAt)}</Body>
        </div>
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: ProbeStatus }) {
  if (status === 'ok') return <Badge variant="secondary">Operational</Badge>
  return <Badge variant="destructive">Down</Badge>
}

function StatusIcon({ status, className }: { status: ProbeStatus; className?: string }) {
  if (status === 'ok') {
    return (
      <CheckCircle2
        className={`h-5 w-5 shrink-0 text-green-600 dark:text-green-500 ${className ?? ''}`}
        aria-label="Operational"
      />
    )
  }
  return (
    <XCircle className={`text-destructive h-5 w-5 shrink-0 ${className ?? ''}`} aria-label="Down" />
  )
}

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso)
    return date.toUTCString()
  } catch {
    return iso
  }
}
