import { useLayoutEffect, useState } from 'react'
import type { Decorator, Preview } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Geist, Geist_Mono } from 'next/font/google'
import { initialize, mswLoader } from 'msw-storybook-addon'
import '../src/app/globals.css'
// MSW handlers for data-fetching stories live in src/stories/msw-handlers.ts.
// Per-story overrides go on `parameters.msw.handlers` in the story file.
import { defaultHandlers } from '../src/stories/msw-handlers'

initialize({ onUnhandledRequest: 'bypass' })

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
  },
  decorators: [withFonts, withQueryClient, withTailwindTheme],
}

export default preview
