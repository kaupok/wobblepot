import type { Decorator, Preview } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { withThemeByClassName } from '@storybook/addon-themes'
import { Geist, Geist_Mono } from 'next/font/google'
import '../src/app/globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

const withFonts: Decorator = (Story) => (
  <div className={`${geistSans.variable} ${geistMono.variable} font-sans`}>
    <Story />
  </div>
)

const withQueryClient: Decorator = (Story) => (
  <QueryClientProvider client={queryClient}>
    <Story />
  </QueryClientProvider>
)

const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: { test: 'todo' },
  },
  decorators: [
    withFonts,
    withQueryClient,
    withThemeByClassName({
      themes: { light: '', dark: 'dark' },
      defaultTheme: 'light',
    }),
  ],
}

export default preview
