import { notFound } from 'next/navigation'

// Debug RSC for HON-526 §2 bullet 7. Throws unhandled so
// instrumentation.onRequestError catches it and emits a PostHog event with
// $exception_source: 'instrumentation.onRequestError'.
//
// Gated by ENABLE_DEBUG_ERRORS=true AND non-production app env.
// Removed in cleanup PR.

export default function DebugRscThrow(): never {
  if (
    process.env.ENABLE_DEBUG_ERRORS !== 'true' ||
    process.env.NEXT_PUBLIC_APP_ENV === 'production'
  ) {
    notFound()
  }
  throw new Error('Debug: deliberate RSC throw (HON-526 bullet 7)')
}
