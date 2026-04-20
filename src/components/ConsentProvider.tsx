'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { decisionToGranted, type ConsentDecision } from '@/lib/consent'
import {
  notifyPosthogGranted,
  notifyPosthogWithdrawn,
  readConsentCookieClient,
  writeConsentCookieClient,
} from '@/lib/consent.client'
import { CookieBanner } from '@/components/CookieBanner'

export interface AnalyticsConsent {
  /** `null` = undecided (banner shown), `true` = opt-in, `false` = essential only. */
  granted: boolean | null
  grant: () => void
  withdraw: () => void
}

/** Exported so tests and Storybook can provide a controlled consent state. */
export const ConsentContext = createContext<AnalyticsConsent | null>(null)

interface ConsentProviderProps {
  children: ReactNode
  /** Consent value read server-side from the cookie, so first render matches. */
  initialDecision: ConsentDecision | null
}

export function ConsentProvider({ children, initialDecision }: ConsentProviderProps) {
  const [granted, setGranted] = useState<boolean | null>(() => decisionToGranted(initialDecision))

  useEffect(() => {
    const clientDecision = readConsentCookieClient()
    const clientGranted = decisionToGranted(clientDecision)
    if (clientGranted !== granted) {
      setGranted(clientGranted)
    }
    // Intentionally runs once on mount — reconciles with any cookie drift between
    // SSR snapshot and hydration (e.g. user cleared cookies in another tab).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grant = useCallback(() => {
    writeConsentCookieClient('all')
    setGranted(true)
    notifyPosthogGranted()
  }, [])

  const withdraw = useCallback(() => {
    writeConsentCookieClient('essential')
    setGranted(false)
    notifyPosthogWithdrawn()
  }, [])

  const value = useMemo<AnalyticsConsent>(
    () => ({ granted, grant, withdraw }),
    [granted, grant, withdraw],
  )

  return (
    <ConsentContext.Provider value={value}>
      {children}
      {granted === null ? <CookieBanner /> : null}
    </ConsentContext.Provider>
  )
}

export function useAnalyticsConsent(): AnalyticsConsent {
  const ctx = useContext(ConsentContext)
  if (!ctx) {
    throw new Error('useAnalyticsConsent must be used within <ConsentProvider>')
  }
  return ctx
}
