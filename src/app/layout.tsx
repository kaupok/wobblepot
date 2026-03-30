import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { headers } from 'next/headers'
import './globals.css'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { Header } from '@/components/header'
import { BottomTabBar } from '@/components/bottom-tab-bar'
import { auth } from '@/lib/auth'
import { hasHouseholdMembership } from '@/lib/household'
import Providers from '@/app/providers'
// Ensure environment variables are validated on app startup
import '@/lib/env'
import { getServerBaseURL } from '@/lib/env'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1a1a' },
  ],
}

export const metadata: Metadata = {
  title: 'Honkadori',
  description: 'AI-powered weekly meal planning for families',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Honkadori',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const baseURL = getServerBaseURL()

  const session = await auth.api.getSession({
    headers: await headers(),
  })
  const hasHousehold = session ? await hasHouseholdMembership(session.user.id) : false

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="x-server-base-url" content={baseURL} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Providers>
            <Toaster richColors closeButton duration={4000} />
            <Header />
            <main
              id="main-content"
              className="mx-auto min-h-screen max-w-[1152px] pt-[calc(4rem+env(safe-area-inset-top,0px))] pb-20 md:pb-0"
            >
              {children}
            </main>
            <BottomTabBar session={session} hasHousehold={hasHousehold} />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  )
}
