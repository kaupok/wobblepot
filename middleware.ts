import { NextRequest, NextResponse } from 'next/server'

function generateNonce(): string {
  const uuid = crypto.randomUUID()
  return btoa(uuid)
}

function buildCspHeader(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development'

  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : " 'strict-dynamic'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.posthog.com",
    "font-src 'self'",
    "connect-src 'self' https://*.posthog.com https://eu.i.posthog.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ]

  if (!isDev) {
    directives.push('upgrade-insecure-requests')
  }

  return directives.join('; ')
}

export function middleware(request: NextRequest) {
  const nonce = generateNonce()
  const cspHeader = buildCspHeader(nonce)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })

  response.headers.set('Content-Security-Policy', cspHeader)

  return response
}

export const config = {
  matcher: [
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js|robots.txt|sitemap.xml).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
}
