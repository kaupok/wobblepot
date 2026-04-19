import { describe, it, expect, vi, beforeEach } from 'vitest'

const nextMock = {
  responseHeaders: new Map<string, string>(),
  requestHeaders: new Map<string, string>(),
}

vi.mock('next/server', () => {
  class MockHeaders extends Map<string, string> {
    constructor(init?: Headers | Map<string, string> | [string, string][]) {
      super()
      if (init instanceof Map || init instanceof MockHeaders) {
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
      nextUrl: { pathname: string }
      constructor(url: string, init?: { headers?: [string, string][] }) {
        this.url = url
        this.headers = new MockHeaders(init?.headers)
        this.nextUrl = { pathname: new URL(url).pathname }
      }
    },
    NextResponse: {
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

describe('middleware', () => {
  beforeEach(() => {
    nextMock.responseHeaders.clear()
    nextMock.requestHeaders.clear()
  })

  it('sets Content-Security-Policy header with nonce', async () => {
    const { middleware } = await import('./middleware')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://honkadori.xyz/')

    middleware(req)

    const csp = nextMock.responseHeaders.get('Content-Security-Policy')
    expect(csp).toBeDefined()
    expect(csp).toMatch(/nonce-[A-Za-z0-9+/=]+/)
  })

  it('does not include unsafe-inline on script-src', async () => {
    const { middleware } = await import('./middleware')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://honkadori.xyz/')

    middleware(req)

    const csp = nextMock.responseHeaders.get('Content-Security-Policy')!
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'))!
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })

  it('includes strict-dynamic in production script-src', async () => {
    const { middleware } = await import('./middleware')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://honkadori.xyz/')

    middleware(req)

    const csp = nextMock.responseHeaders.get('Content-Security-Policy')!
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'))!
    expect(scriptSrc).toContain("'strict-dynamic'")
  })

  it('forwards nonce via x-nonce request header', async () => {
    const { middleware } = await import('./middleware')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://honkadori.xyz/')

    middleware(req)

    const nonce = nextMock.requestHeaders.get('x-nonce')
    expect(nonce).toBeDefined()
    expect(nonce!.length).toBeGreaterThan(0)
  })

  it('generates unique nonces per request', async () => {
    const { middleware } = await import('./middleware')
    const { NextRequest } = await import('next/server')

    middleware(new NextRequest('https://honkadori.xyz/'))
    const nonce1 = nextMock.requestHeaders.get('x-nonce')

    nextMock.requestHeaders.clear()
    nextMock.responseHeaders.clear()

    middleware(new NextRequest('https://honkadori.xyz/page'))
    const nonce2 = nextMock.requestHeaders.get('x-nonce')

    expect(nonce1).not.toEqual(nonce2)
  })

  it('nonce in request header matches nonce in CSP', async () => {
    const { middleware } = await import('./middleware')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://honkadori.xyz/')

    middleware(req)

    const nonce = nextMock.requestHeaders.get('x-nonce')!
    const csp = nextMock.responseHeaders.get('Content-Security-Policy')!
    expect(csp).toContain(`'nonce-${nonce}'`)
  })

  it('includes all required CSP directives', async () => {
    const { middleware } = await import('./middleware')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://honkadori.xyz/')

    middleware(req)

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
    const { middleware } = await import('./middleware')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://honkadori.xyz/')

    middleware(req)

    const csp = nextMock.responseHeaders.get('Content-Security-Policy')!
    const imgSrc = csp.split(';').find((d) => d.trim().startsWith('img-src'))!
    const connectSrc = csp.split(';').find((d) => d.trim().startsWith('connect-src'))!

    expect(imgSrc).toContain('https://*.posthog.com')
    expect(connectSrc).toContain('https://*.posthog.com')
    expect(connectSrc).toContain('https://eu.i.posthog.com')
  })

  it('includes upgrade-insecure-requests in production', async () => {
    const { middleware } = await import('./middleware')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('https://honkadori.xyz/')

    middleware(req)

    const csp = nextMock.responseHeaders.get('Content-Security-Policy')!
    expect(csp).toContain('upgrade-insecure-requests')
  })
})
