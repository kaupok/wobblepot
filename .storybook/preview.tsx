import { useLayoutEffect, useState } from 'react'
import type { Decorator, Preview } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { Geist, Geist_Mono } from 'next/font/google'
import { initialize, mswLoader } from 'msw-storybook-addon'
import { MINIMAL_VIEWPORTS } from 'storybook/viewport'
import '../src/app/globals.css'
// MSW handlers for data-fetching stories live in src/stories/msw-handlers.ts.
// Per-story overrides go on `parameters.msw.handlers` in the story file.
import { defaultHandlers } from '../src/stories/msw-handlers'
import enMessages from '../messages/en.json'
import etMessages from '../messages/et.json'

const messagesByLocale = { en: enMessages, et: etMessages } as const
type StorybookLocale = keyof typeof messagesByLocale

initialize({
  onUnhandledRequest: 'bypass',
  // WHY: msw defaults to the origin-absolute `/mockServiceWorker.js`. The static
  // build is served from a sub-path on GitHub Pages (/wobblepot/), where that
  // URL 404s and every story then fails inside the msw loader — not just the
  // data-fetching ones. BASE_URL is '/' in `storybook dev` and in the Vitest
  // browser project (behaviour unchanged there) and './' in `storybook build`,
  // where it resolves relative to iframe.html. Don't replace it with a bare
  // './mockServiceWorker.js': the Vitest tester iframe lives under
  // /__vitest_test__/, so a relative URL 404s and takes the CI a11y gate down.
  serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
})

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

function FontDecorator({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    const body = document.body
    const classes = [geistSans.variable, geistMono.variable, 'font-sans']
    body.classList.add(...classes)
    return () => {
      body.classList.remove(...classes)
    }
  }, [])
  return <>{children}</>
}

const withFonts: Decorator = (Story) => (
  <FontDecorator>
    <Story />
  </FontDecorator>
)

function QueryClientDecorator({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const withQueryClient: Decorator = (Story) => (
  <QueryClientDecorator>
    <Story />
  </QueryClientDecorator>
)

function TailwindThemeDecorator({ theme, children }: { theme: string; children: React.ReactNode }) {
  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    return () => {
      root.classList.remove('dark')
    }
  }, [theme])
  return <>{children}</>
}

const withTailwindTheme: Decorator = (Story, context) => {
  const theme = (context.globals.theme as string | undefined) ?? 'light'
  return (
    <TailwindThemeDecorator theme={theme}>
      <Story />
    </TailwindThemeDecorator>
  )
}

function ReducedMotionDecorator({
  reducedMotion,
  children,
}: {
  reducedMotion: string
  children: React.ReactNode
}) {
  useLayoutEffect(() => {
    const root = document.documentElement
    if (reducedMotion === 'on') {
      root.setAttribute('data-reduced-motion', 'true')
    } else {
      root.removeAttribute('data-reduced-motion')
    }
    return () => {
      root.removeAttribute('data-reduced-motion')
    }
  }, [reducedMotion])
  return <>{children}</>
}

const withReducedMotion: Decorator = (Story, context) => {
  const reducedMotion = (context.globals.reducedMotion as string | undefined) ?? 'off'
  return (
    <ReducedMotionDecorator reducedMotion={reducedMotion}>
      <Story />
    </ReducedMotionDecorator>
  )
}

const withI18n: Decorator = (Story, context) => {
  const globalLocale = (context.globals.locale as StorybookLocale | undefined) ?? 'en'
  const locale = globalLocale in messagesByLocale ? globalLocale : 'en'
  return (
    <NextIntlClientProvider locale={locale} messages={messagesByLocale[locale]}>
      <Story />
    </NextIntlClientProvider>
  )
}

// Custom viewports matching common mobile device sizes the app targets. The
// built-in MINIMAL_VIEWPORTS.mobile1 is iPhone 5 (320×568), too small for a
// mobile-first audit; these add realistic iPhone 13/14 (390×844) and Pixel-class
// Android (360×640) sizes and re-use the built-in desktop preset.
const honkadoriViewports = {
  mobilePixel: {
    name: 'Mobile — 360×640',
    styles: { width: '360px', height: '640px' },
    type: 'mobile',
  },
  mobileIphone: {
    name: 'Mobile — 390×844 (iPhone)',
    styles: { width: '390px', height: '844px' },
    type: 'mobile',
  },
} as const

const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: { test: 'error' },
    nextjs: { appDirectory: true },
    msw: { handlers: { default: defaultHandlers } },
    viewport: {
      options: {
        ...honkadoriViewports,
        ...MINIMAL_VIEWPORTS,
      },
    },
  },
  initialGlobals: {
    viewport: { value: 'mobileIphone', isRotated: false },
  },
  loaders: [mswLoader],
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Tailwind theme',
      defaultValue: 'light',
      toolbar: {
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    reducedMotion: {
      name: 'Reduced motion',
      description: 'Simulates prefers-reduced-motion: reduce via data-reduced-motion on <html>',
      defaultValue: 'off',
      toolbar: {
        icon: 'accessibility',
        items: [
          { value: 'off', title: 'Motion: on' },
          { value: 'on', title: 'Motion: reduced' },
        ],
        dynamicTitle: true,
      },
    },
    locale: {
      name: 'Locale',
      description: 'i18n message catalog',
      defaultValue: 'en',
      toolbar: {
        icon: 'globe',
        items: [
          { value: 'en', title: 'English' },
          { value: 'et', title: 'Eesti' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [withFonts, withQueryClient, withI18n, withTailwindTheme, withReducedMotion],
}

export default preview
