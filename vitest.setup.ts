import { createElement, Fragment, type ReactNode } from 'react'
import { afterEach, vi } from 'vitest'

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
type RichValue = string | number | ((chunks: ReactNode) => ReactNode)

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
    // Handle plain placeholders: `{name}`, and `{name, number}` as English
    // formats it ("1.5"); a test of another locale uses the real provider.
    out = out.replace(/\{(\w+)(?:,\s*number)?\}/g, (_match, name: string) => {
      const v = values[name]
      return v === undefined ? `{${name}}` : String(v)
    })
    return out
  }
  return {
    ...actual,
    useTranslations: (namespace?: string) => {
      const prefix = namespace ? `${namespace}.` : ''
      const t = (key: string, values?: Record<string, string | number>) =>
        applyValues(resolve(`${prefix}${key}`), values)
      // `t.rich`: plain values as above, then each `<tag>…</tag>` handed to its
      // handler. Flat tags only — nested tags are not used in the catalog.
      t.rich = (key: string, values: Record<string, RichValue> = {}): ReactNode => {
        const plain: Record<string, string | number> = {}
        for (const [name, value] of Object.entries(values)) {
          if (typeof value !== 'function') plain[name] = value
        }
        const text = applyValues(resolve(`${prefix}${key}`), plain)
        const parts: ReactNode[] = []
        let last = 0
        for (const match of text.matchAll(/<(\w+)>(.*?)<\/\1>/g)) {
          parts.push(text.slice(last, match.index))
          const handler = values[match[1] ?? '']
          const chunks = match[2] ?? ''
          parts.push(
            createElement(
              Fragment,
              { key: match.index },
              typeof handler === 'function' ? handler(chunks) : chunks,
            ),
          )
          last = match.index + match[0].length
        }
        parts.push(text.slice(last))
        return parts
      }
      return t
    },
    // Tests that need locale switching call `vi.unmock('next-intl')` and wrap
    // in a real provider; the default mock just hands back 'en' so callers
    // don't need to know whether their component tree uses `useLocale`.
    useLocale: () => 'en',
    NextIntlClientProvider: ({ children }: { children: ReactNode }) => children,
  }
})

// `next/font/google` is a build-time SWC transform; calling the real loader in
// Vitest throws. The landing page and the cook view only read `.variable` off
// the result (src/components/landing/display-font.ts).
vi.mock('next/font/google', () => ({
  Bricolage_Grotesque: () => ({ variable: 'bricolage-variable' }),
}))

// Loading the real `src/lib/auth.ts` starts the `mcp()` plugin, whose init
// seeds the MCP resource row through `prisma.oauthResource`. With no database
// listening, that query rejects outside any test and Vitest fails the run on
// the unhandled rejection (HON-1183). Answer the seed in memory, so the unit
// suite needs no database. Every other delegate is the real one, and a file
// that mocks `@/lib/prisma` itself replaces this mock.
vi.mock('@/lib/prisma', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/prisma')>()
  type Write = { data: Record<string, unknown> }
  // `merge` seeding reads the row, then creates or updates it (HON-1154).
  const oauthResource = {
    findFirst: async () => null,
    create: async ({ data }: Write) => data,
    update: async ({ data }: Write) => data,
  }
  const prisma = new Proxy(actual.prisma, {
    get(target, property) {
      if (property === 'oauthResource') return oauthResource
      const value: unknown = Reflect.get(target, property, target)
      // Bind to the real client: Prisma's methods expect it as `this`. A spy
      // is returned as is, so assertions on it still see its calls.
      return typeof value === 'function' && !vi.isMockFunction(value) ? value.bind(target) : value
    },
  })
  return { ...actual, prisma }
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

// DOM matchers and React cleanup only mean something with a window. Files in
// the `unit-node` project skip them, so they do not pay to load react-dom
// (HON-1178); a `// @vitest-environment jsdom` file still gets both.
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  const { cleanup } = await import('@testing-library/react')
  afterEach(() => cleanup())
}
