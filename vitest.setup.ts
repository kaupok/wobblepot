import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import enMessages from './messages/en.json'

// next-intl provider context isn't set up in unit tests by default. Most tests
// don't need real translations — they just need `useTranslations` /
// `useEnumLabel` to return *something* sensible. Resolve the requested
// namespace + key against the English catalog; fall back to the key.
//
// Tests that genuinely need locale switching (e.g. enum-label.test.tsx,
// CategoryGroup.test.tsx) call `vi.unmock('next-intl')` at the top of the
// file to disable this mock entirely and use the real next-intl exports.
// Without that unmock, the no-op `NextIntlClientProvider` below would swallow
// the test's explicit locale/messages props and silently render against the
// English fallback regardless of the locale prop.
vi.mock('next-intl', async () => {
  const actual = await vi.importActual<typeof import('next-intl')>('next-intl')
  function resolve(path: string): string {
    const segments = path.split('.')
    let node: unknown = enMessages
    for (const segment of segments) {
      if (node && typeof node === 'object' && segment in (node as Record<string, unknown>)) {
        node = (node as Record<string, unknown>)[segment]
      } else {
        return path
      }
    }
    return typeof node === 'string' ? node : path
  }
  return {
    ...actual,
    useTranslations: (namespace?: string) => {
      const prefix = namespace ? `${namespace}.` : ''
      return (key: string) => resolve(`${prefix}${key}`)
    },
    // Tests that need locale switching call `vi.unmock('next-intl')` and wrap
    // in a real provider; the default mock just hands back 'en' so callers
    // don't need to know whether their component tree uses `useLocale`.
    useLocale: () => 'en',
    NextIntlClientProvider: ({ children }: { children: ReactNode }) => children,
  }
})

// Mock ResizeObserver for Radix UI components
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserver

// Mock window.matchMedia for Radix UI (skipped when running node-env tests)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

afterEach(() => cleanup())
