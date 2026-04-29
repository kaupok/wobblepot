import { notFound } from 'next/navigation'
import { Heading, Body } from '@/components/ui/typography'
import { DebugErrorButtons } from './DebugErrorButtons'

// Debug page for HON-526 §2 verification. Gated by ENABLE_DEBUG_ERRORS=true
// AND non-production app env; 404s otherwise. Removed in cleanup PR.

export default function DebugErrorsPage() {
  if (
    process.env.ENABLE_DEBUG_ERRORS !== 'true' ||
    process.env.NEXT_PUBLIC_APP_ENV === 'production'
  ) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="flex flex-col gap-3">
        <Heading variant="h2">HON-526 §2 debug page</Heading>
        <Body variant="muted">
          Each button triggers a deliberate failure to verify PostHog error capture wiring. Watch
          the staging PostHog project for the resulting <code>$exception</code> events.
        </Body>
      </div>
      <DebugErrorButtons />
    </div>
  )
}
