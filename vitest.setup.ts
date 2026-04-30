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
  function applyValues(template: string, values?: Record<string, string | number>): string {
    if (!values) return template
    // Handle ICU plurals: `{count, plural, =0 {…} one {…} other {…}}`
    // The plural body may contain two levels of nested braces (arms with
    // their own `{rows}` placeholders), so both regexes accept up to that
    // depth. Deeper nesting is unsupported here — mirror the production
    // catalog if you need more.
    const pluralRe = /\{(\w+),\s*plural,\s*((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g
    let out = template.replace(pluralRe, (_match, varName: string, body: string) => {
      const raw = values[varName]
      const count = typeof raw === 'number' ? raw : Number(raw)
      const arms = new Map<string, string>()
      // Body looks like: =0 {No items} one {# item} other {# items {rows}}
      const armRe = /(=\d+|zero|one|two|few|many|other)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g
      let armMatch: RegExpExecArray | null
      while ((armMatch = armRe.exec(body)) !== null) {
        arms.set(armMatch[1] ?? '', armMatch[2] ?? '')
      }
      const pick =
        arms.get(`=${count}`) ?? (count === 1 ? arms.get('one') : null) ?? arms.get('other') ?? ''
      // Resolve any nested `{name}` placeholders within the picked arm body
      // before substituting `#` for the count itself.
      const resolved = pick.replace(/\{(\w+)\}/g, (_m, name: string) => {
        const v = values[name]
        return v === undefined ? `{${name}}` : String(v)
      })
      return resolved.replace(/#/g, String(count))
    })
    // Handle plain placeholders: `{name}`
    out = out.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const v = values[name]
      return v === undefined ? `{${name}}` : String(v)
    })
    return out
  }
  return {
    ...actual,
    useTranslations: (namespace?: string) => {
      const prefix = namespace ? `${namespace}.` : ''
      return (key: string, values?: Record<string, string | number>) =>
        applyValues(resolve(`${prefix}${key}`), values)
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
