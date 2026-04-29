import { notFound } from 'next/navigation'
import { serverEnv } from '@/lib/env'

// Debug RSC for HON-526 §2 bullet 7. Throws unhandled so
// instrumentation.onRequestError catches it and emits a PostHog event with
// $exception_source: 'instrumentation.onRequestError'.
//
// Gated by ENABLE_DEBUG_ERRORS=1 (or "true") AND non-production app env.
// Removed in cleanup PR.

export default function DebugRscThrow(): never {
  const raw = serverEnv.ENABLE_DEBUG_ERRORS
  const enabled = raw === '1' || raw === 'true'
  if (!enabled || serverEnv.NEXT_PUBLIC_APP_ENV === 'production') {
    notFound()
  }
  throw new Error('Debug: deliberate RSC throw (HON-526 bullet 7)')
}
