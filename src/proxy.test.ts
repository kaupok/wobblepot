import { describe, it, expect, vi, beforeEach } from 'vitest'

const nextMock = {
  responseHeaders: new Map<string, string>(),
  requestHeaders: new Map<string, string>(),
  redirect: null as { status: number; location: string } | null,
}

vi.mock('next/server', () => {
  class MockHeaders extends Map<string, string> {
    constructor(init?: Headers | Map<string, string> | [string, string][]) {
      super()
      if (Array.isArray(init)) {
        init.forEach(([k, v]) => this.set(k, v))
      } else if (init instanceof Map || init instanceof MockHeaders) {
        init.forEach((v, k) => this.set(k, v))
      }
    }
    append(name: string, value: string) {
      this.set(name, value)
    }
  }

  return {
    NextRequest: class {
      url: string
      headers: MockHeaders
      nextUrl: { pathname: string; search: string }
      constructor(url: string, init?: { headers?: [string, string][] }) {
        this.url = url
        this.headers = new MockHeaders(init?.headers)
        const parsed = new URL(url)
        this.nextUrl = { pathname: parsed.pathname, search: parsed.search }
      }
    },
    NextResponse: {
      // Mirrors the real signature: status defaults to 307 and the target is
      // exposed via the `Location` response header.
      redirect: (url: URL | string, init?: number | { status?: number }) => {
        const status = typeof init === 'number' ? init : (init?.status ?? 307)
        const location = url.toString()
        nextMock.redirect = { status, location }
        nextMock.responseHeaders.set('Location', location)
        return {
          status,
          headers: {
            set: (k: string, v: string) => nextMock.responseHeaders.set(k, v),
            get: (k: string) => nextMock.responseHeaders.get(k),
          },
        }
      },
      next: ({ request }: { request?: { headers?: Map<string, string> } } = {}) => {
        if (request?.headers) {
          request.headers.forEach((v, k) => nextMock.requestHeaders.set(k, v))
        }
        return {
          headers: {
            set: (k: string, v: string) => nextMock.responseHeaders.set(k, v),
            get: (k: string) => nextMock.responseHeaders.get(k),
          },
        }
      },
    },
  }
})

describe('proxy', () => {
  beforeEach(() => {
    nextMock.responseHeaders.clear()
    nextMock.requestHeaders.clear()
    nextMock.redirect = null
  })

  it('sets Content-Security-Policy header with nonce', async () => {
    const { proxy } = await import('./proxy')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://wobblepot.dev/')

    proxy(req)

    const csp = nextMock.responseHeaders.get('Content-Security-Policy')
    expect(csp).toBeDefined()
    expect(csp).toMatch(/nonce-[A-Za-z0-9+/=]+/)
  })

  it('does not include unsafe-inline on script-src', async () => {
    const { proxy } = await import('./proxy')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://wobblepot.dev/')

    proxy(req)

    const csp = nextMock.responseHeaders.get('Content-Security-Policy')!
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'))!
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })

  it('includes strict-dynamic in production script-src', async () => {
    const { proxy } = await import('./proxy')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://wobblepot.dev/')

    proxy(req)

    const csp = nextMock.responseHeaders.get('Content-Security-Policy')!
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'))!
    expect(scriptSrc).toContain("'strict-dynamic'")
  })

  it('forwards nonce via x-nonce request header', async () => {
    const { proxy } = await import('./proxy')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://wobblepot.dev/')

    proxy(req)

    const nonce = nextMock.requestHeaders.get('x-nonce')
    expect(nonce).toBeDefined()
    expect(nonce!.length).toBeGreaterThan(0)
  })

  it('generates unique nonces per request', async () => {
    const { proxy } = await import('./proxy')
    const { NextRequest } = await import('next/server')

    proxy(new NextRequest('https://wobblepot.dev/'))
    const nonce1 = nextMock.requestHeaders.get('x-nonce')

    nextMock.requestHeaders.clear()
    nextMock.responseHeaders.clear()

    proxy(new NextRequest('https://wobblepot.dev/page'))
    const nonce2 = nextMock.requestHeaders.get('x-nonce')

    expect(nonce1).not.toEqual(nonce2)
  })

  it('nonce in request header matches nonce in CSP', async () => {
    const { proxy } = await import('./proxy')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://wobblepot.dev/')

    proxy(req)

    const nonce = nextMock.requestHeaders.get('x-nonce')!
    const csp = nextMock.responseHeaders.get('Content-Security-Policy')!
    expect(csp).toContain(`'nonce-${nonce}'`)
  })

  it('includes all required CSP directives', async () => {
    const { proxy } = await import('./proxy')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://wobblepot.dev/')

    proxy(req)

    const csp = nextMock.responseHeaders.get('Content-Security-Policy')!
    const directives = csp.split(';').map((d) => d.trim().split(' ')[0])

    expect(directives).toContain('default-src')
    expect(directives).toContain('script-src')
    expect(directives).toContain('style-src')
    expect(directives).toContain('img-src')
    expect(directives).toContain('font-src')
    expect(directives).toContain('connect-src')
    expect(directives).toContain('frame-ancestors')
    expect(directives).toContain('base-uri')
    expect(directives).toContain('form-action')
    expect(directives).toContain('object-src')
  })

  it('includes PostHog domains in img-src and connect-src', async () => {
    const { proxy } = await import('./proxy')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://wobblepot.dev/')

    proxy(req)

    const csp = nextMock.responseHeaders.get('Content-Security-Policy')!
    const imgSrc = csp.split(';').find((d) => d.trim().startsWith('img-src'))!
    const connectSrc = csp.split(';').find((d) => d.trim().startsWith('connect-src'))!

    expect(imgSrc).toContain('https://*.posthog.com')
    expect(connectSrc).toContain('https://*.posthog.com')
    expect(connectSrc).toContain('https://eu.i.posthog.com')
  })

  it('includes upgrade-insecure-requests in production', async () => {
    const { proxy } = await import('./proxy')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://wobblepot.dev/')

    proxy(req)

    const csp = nextMock.responseHeaders.get('Content-Security-Policy')!
    expect(csp).toContain('upgrade-insecure-requests')
  })
})

describe('proxy — protected-route redirect (HON-599)', () => {
  beforeEach(() => {
    nextMock.responseHeaders.clear()
    nextMock.requestHeaders.clear()
    nextMock.redirect = null
  })

  // Returns the proxy's own return value. Asserting on it (rather than only on
  // `nextMock.redirect`, which the stub sets at *call* time) is what proves the
  // redirect is actually returned — dropping the `return` in proxy.ts would
  // otherwise leave every case here green while the page rendered anyway.
  async function run(url: string, cookie?: string) {
    const { proxy } = await import('./proxy')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest(url, cookie ? { headers: [['cookie', cookie]] } : undefined)
    return proxy(req)
  }

  it('redirects an anonymous request to a protected route with a 307', async () => {
    const response = await run('https://wobblepot.dev/profile')

    expect(response).toMatchObject({ status: 307 })
    expect(nextMock.redirect).toEqual({
      status: 307,
      location: 'https://wobblepot.dev/sign-in?returnUrl=%2Fprofile',
    })
    // The redirect must be an early return — it never reaches the CSP path.
    expect(nextMock.responseHeaders.get('Content-Security-Policy')).toBeUndefined()
  })

  it('preserves the query string in returnUrl', async () => {
    await run('https://wobblepot.dev/invite/abc?x=1')

    expect(nextMock.redirect?.location).toBe(
      'https://wobblepot.dev/sign-in?returnUrl=%2Finvite%2Fabc%3Fx%3D1',
    )
  })

  it('redirects nested paths under a protected prefix', async () => {
    await run('https://wobblepot.dev/recipes/123/edit')

    expect(nextMock.redirect?.location).toBe(
      'https://wobblepot.dev/sign-in?returnUrl=%2Frecipes%2F123%2Fedit',
    )
  })

  // Next appends `_rsc=<hash>` (NEXT_RSC_UNION_QUERY) to every client-side
  // navigation fetch. `config.matcher` only excludes prefetches, so a soft nav
  // reaches the proxy carrying it — and it must not survive into the URL the
  // user lands on after signing in.
  it('strips Next’s _rsc cache-busting param from returnUrl', async () => {
    await run('https://wobblepot.dev/recipes?_rsc=1f2a3b')

    expect(nextMock.redirect?.location).toBe('https://wobblepot.dev/sign-in?returnUrl=%2Frecipes')
  })

  it('keeps real query params when stripping _rsc', async () => {
    await run('https://wobblepot.dev/invite/abc?x=1&_rsc=1f2a3b')

    expect(nextMock.redirect?.location).toBe(
      'https://wobblepot.dev/sign-in?returnUrl=%2Finvite%2Fabc%3Fx%3D1',
    )
  })

  it('redirects every prefix in PROTECTED_PREFIXES when anonymous', async () => {
    const { PROTECTED_PREFIXES } = await import('./proxy')

    for (const prefix of PROTECTED_PREFIXES) {
      nextMock.redirect = null
      nextMock.responseHeaders.clear()

      const response = await run(`https://wobblepot.dev${prefix}`)

      expect(response, `${prefix} should return the redirect`).toMatchObject({ status: 307 })
      expect(nextMock.redirect, `${prefix} should redirect when anonymous`).not.toBeNull()
      expect(nextMock.redirect!.location).toBe(
        `https://wobblepot.dev/sign-in?returnUrl=${encodeURIComponent(prefix)}`,
      )
    }
  })

  it('passes through when the session cookie is present', async () => {
    await run('https://wobblepot.dev/profile', 'better-auth.session_token=abc.def')

    expect(nextMock.redirect).toBeNull()
    expect(nextMock.responseHeaders.get('Content-Security-Policy')).toBeDefined()
  })

  it('passes through with the __Secure- prefixed session cookie', async () => {
    await run('https://wobblepot.dev/profile', '__Secure-better-auth.session_token=abc.def')

    expect(nextMock.redirect).toBeNull()
    expect(nextMock.responseHeaders.get('Content-Security-Policy')).toBeDefined()
  })

  // A non-session cookie must not be mistaken for one.
  it('redirects when only unrelated cookies are present', async () => {
    await run('https://wobblepot.dev/profile', 'theme=dark; NEXT_LOCALE=et')

    expect(nextMock.redirect?.status).toBe(307)
  })

  // Each of these must reach the CSP path — asserting the header proves the
  // normal (non-redirect) branch ran rather than an early return.
  it.each([
    ['/', 'public landing page'],
    ['/sign-in', 'public — never redirect, would loop on a stale cookie'],
    ['/sign-up', 'public'],
    ['/status', 'public'],
    ['/api/meals', 'API routes return their own 401 JSON'],
    ['/admin/signup-codes', 'admin must 404, not advertise itself via a sign-in redirect'],
    ['/profilex', 'prefix boundary — not under /profile'],
    ['/recipes-public', 'prefix boundary — not under /recipes'],
  ])('does not redirect anonymous %s (%s)', async (pathname) => {
    await run(`https://wobblepot.dev${pathname}`)

    expect(nextMock.redirect).toBeNull()
    expect(nextMock.responseHeaders.get('Content-Security-Policy')).toBeDefined()
  })
})
