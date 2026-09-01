import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// `next/font/google` is a build-time SWC transform; calling the real loader in
// Vitest throws. The layout only reads `.variable` off the result.
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: '--font-geist-sans' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono' }),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
  getHouseholdIdForUser: vi.fn(),
}))

vi.mock('@/lib/consent.server', () => ({
  readConsentCookieServer: vi.fn(),
}))

vi.mock('@/lib/i18n/get-locale', () => ({
  getLocale: vi.fn(),
}))

vi.mock('next-intl/server', () => ({
  getMessages: vi.fn(),
  getTranslations: vi.fn(),
}))

vi.mock('@/lib/feature-flags', () => ({
  bootstrapFlags: vi.fn(),
}))

// The children are only ever inspected as elements here — the layout is never
// rendered to the DOM — so stub them to keep the module graph light.
vi.mock('@/app/providers', () => ({ default: () => null }))
vi.mock('@/components/header', () => ({ Header: () => null }))
vi.mock('@/components/footer', () => ({ Footer: () => null }))
vi.mock('@/components/bottom-tab-bar', () => ({ BottomTabBar: () => null }))
vi.mock('@/components/theme-provider', () => ({ ThemeProvider: () => null }))
vi.mock('@/components/ConsentProvider', () => ({ ConsentProvider: () => null }))

import { getSession, getHouseholdIdForUser } from '@/lib/session'
import { readConsentCookieServer } from '@/lib/consent.server'
import { getLocale } from '@/lib/i18n/get-locale'
import { getMessages } from 'next-intl/server'
import { bootstrapFlags } from '@/lib/feature-flags'
import RootLayout from './layout'

const mockGetSession = vi.mocked(getSession)
const mockGetHouseholdIdForUser = vi.mocked(getHouseholdIdForUser)
const mockReadConsentCookieServer = vi.mocked(readConsentCookieServer)
const mockGetLocale = vi.mocked(getLocale)
const mockGetMessages = vi.mocked(getMessages)
const mockBootstrapFlags = vi.mocked(bootstrapFlags)

type Session = Awaited<ReturnType<typeof getSession>>

const SIGNED_IN = {
  user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
  session: { id: 'session-1' },
} as unknown as NonNullable<Session>

const BOOTSTRAP = {
  distinctID: 'anonymous',
  featureFlags: {},
} as unknown as Awaited<ReturnType<typeof bootstrapFlags>>

/** A promise plus the settle handle for it, so a test can hold it pending. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/**
 * Walk the returned element tree and return the props of the first element
 * carrying `propName`. Matching on the prop rather than on component identity
 * keeps the assertion decoupled from where in the tree the prop is passed.
 */
function findPropsWith(node: ReactNode, propName: string): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findPropsWith(child, propName)
      if (found) return found
    }
    return null
  }

  if (!isValidElement(node)) return null

  const props = (node as ReactElement).props as Record<string, unknown>
  if (propName in props) return props

  return findPropsWith(props.children as ReactNode, propName)
}

describe('RootLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
    mockGetHouseholdIdForUser.mockResolvedValue(null)
    mockReadConsentCookieServer.mockResolvedValue(null)
    mockGetLocale.mockResolvedValue('en')
    mockGetMessages.mockResolvedValue({})
    mockBootstrapFlags.mockResolvedValue(BOOTSTRAP)
  })

  it('starts the session-independent lookups before the session resolves', async () => {
    const session = deferred<Session>()
    mockGetSession.mockReturnValue(session.promise)

    let settled = false
    const tree = RootLayout({ children: null }).then((value) => {
      settled = true
      return value
    })

    await vi.waitFor(() => {
      expect(mockReadConsentCookieServer).toHaveBeenCalled()
      expect(mockGetLocale).toHaveBeenCalled()
      expect(mockGetMessages).toHaveBeenCalled()
    })

    // All three ran while `getSession` was still pending — that is the whole
    // point of the first `Promise.all` stage.
    expect(settled).toBe(false)

    session.resolve(null)
    await tree
    expect(settled).toBe(true)
  })

  it('overlaps the household lookup with the feature-flag bootstrap', async () => {
    const householdId = deferred<string | null>()
    mockGetSession.mockResolvedValue(SIGNED_IN)
    mockGetHouseholdIdForUser.mockReturnValue(householdId.promise)

    const tree = RootLayout({ children: null })

    await vi.waitFor(() => {
      expect(mockGetHouseholdIdForUser).toHaveBeenCalledWith('user-1')
      expect(mockBootstrapFlags).toHaveBeenCalledWith('user-1')
    })

    householdId.resolve('household-1')
    const props = findPropsWith(await tree, 'hasHousehold')
    expect(props?.hasHousehold).toBe(true)
  })

  it('renders the signed-out tree without touching the household lookup', async () => {
    const element = await RootLayout({ children: null })

    const providerProps = findPropsWith(element, 'isAuthenticated')
    expect(providerProps?.isAuthenticated).toBe(false)

    const tabBarProps = findPropsWith(element, 'hasHousehold')
    expect(tabBarProps?.hasHousehold).toBe(false)

    expect(mockGetHouseholdIdForUser).not.toHaveBeenCalled()
    expect(mockBootstrapFlags).toHaveBeenCalledWith('anonymous')
  })
})
