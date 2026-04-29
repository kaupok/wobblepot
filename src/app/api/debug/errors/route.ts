import 'server-only'
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { captureApiError } from '@/lib/errors'
import { externalFetch } from '@/lib/external-fetch'
import { MealPlanValidationError } from '@/lib/ai/types'
import { withRequestId } from '@/lib/request-id'
import { serverEnv } from '@/lib/env'

// Debug endpoints for HON-526 §2 verification. Each `?case=` exercises a specific
// PostHog capture path. Gated by ENABLE_DEBUG_ERRORS=1 (or "true") AND non-production
// app env. Removed in the HON-526 cleanup PR.

function debugDisabled(): boolean {
  const raw = serverEnv.ENABLE_DEBUG_ERRORS
  const enabled = raw === '1' || raw === 'true'
  return !enabled || serverEnv.NEXT_PUBLIC_APP_ENV === 'production'
}

async function handle(request: Request): Promise<Response> {
  if (debugDisabled()) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const url = new URL(request.url)
  const testCase = url.searchParams.get('case')

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null)
  const userId = session?.user.id

  switch (testCase) {
    case 'throw': {
      try {
        throw new Error('Debug: deliberate API throw (HON-526 bullets 1, 9)')
      } catch (error) {
        captureApiError(error, {
          route: '/api/debug/errors',
          userId,
          $exception_source: 'debug.api.throw',
        })
        return NextResponse.json({ ok: false, captured: true, case: testCase }, { status: 500 })
      }
    }

    case 'typed': {
      try {
        throw new MealPlanValidationError(
          'Debug: simulated MealPlanValidationError (HON-526 bullet 4)',
        )
      } catch (error) {
        captureApiError(error, {
          route: '/api/debug/errors',
          userId,
          feature: 'plan_generate',
        })
        return NextResponse.json({ ok: false, captured: true, case: testCase }, { status: 422 })
      }
    }

    case 'pii': {
      try {
        throw new Error('Debug: PII scrub test (HON-526 bullet 8)')
      } catch (error) {
        captureApiError(error, {
          route: '/api/debug/errors',
          userId,
          email: 'leak@test.example',
          password: 'should-be-stripped',
          token: 'tok-should-be-stripped',
          $exception_source: 'debug.api.pii',
        })
        return NextResponse.json({ ok: false, captured: true, case: testCase }, { status: 500 })
      }
    }

    case 'ext-fetch-fail': {
      try {
        await externalFetch(
          'https://hibp-broken.honkadori.invalid/range/00000',
          { method: 'GET' },
          { feature: 'breached_password_check', route: '/api/debug/errors' },
        )
      } catch {
        // externalFetch already captured the network error.
      }
      return NextResponse.json({ ok: false, captured: true, case: testCase }, { status: 200 })
    }

    default:
      return NextResponse.json(
        {
          error: 'Unknown case',
          available: ['throw', 'typed', 'pii', 'ext-fetch-fail'],
        },
        { status: 400 },
      )
  }
}

export const GET = withRequestId(handle)
export const POST = withRequestId(handle)
