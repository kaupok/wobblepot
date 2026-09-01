import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { headers } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import './globals.css'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { Header } from '@/components/header'
import { BottomTabBar } from '@/components/bottom-tab-bar'
import { Footer } from '@/components/footer'
import { ConsentProvider } from '@/components/ConsentProvider'
import { getSession, getHouseholdIdForUser } from '@/lib/session'
import { readConsentCookieServer } from '@/lib/consent.server'
import { getLocale } from '@/lib/i18n/get-locale'
import { toOgLocale } from '@/lib/i18n/og-locale'
import { bootstrapFlags } from '@/lib/feature-flags'
import Providers from '@/app/providers'
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta.root')
  const locale = await getLocale()
  const title = t('title')
  const titleTemplate = t('titleTemplate')
  const description = t('description')
  const ogTitle = t('ogTitle')
  const ogDescription = t('ogDescription')

  return {
    metadataBase: new URL(getServerBaseURL()),
    title: { default: title, template: titleTemplate },
    description,
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url: '/',
      siteName: title,
      images: [{ url: '/og-image.png', width: 1200, height: 630 }],
      type: 'website',
      locale: toOgLocale(locale),
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: ogDescription,
      images: ['/og-image.png'],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title,
    },
    icons: {
      icon: [
        { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
        { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
      apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const baseURL = getServerBaseURL()
  const nonce = (await headers()).get('x-nonce') ?? undefined

  // Nothing here depends on the session: the consent cookie, the locale, and
  // the message catalog resolve independently. `getLocale` does call
  // `getSession` internally, but both are `cache()`-wrapped in
  // `@/lib/session`, so the two callers share one in-flight auth lookup.
  const [session, consentDecision, locale, messages] = await Promise.all([
    getSession(),
    readConsentCookieServer(),
    getLocale(),
    getMessages(),
  ])

  // Both of these need the resolved session, but not each other — the
  // household lookup (Prisma) and the flag bootstrap (PostHog round-trip)
  // overlap. Feature flags are evaluated server-side so PostHog's client SDK
  // can answer `isFeatureEnabled` synchronously on first render; fail-open
  // semantics live in `getServerFlag`, so this never throws and never blocks
  // the page.
  const [householdId, bootstrap] = await Promise.all([
    session ? getHouseholdIdForUser(session.user.id) : Promise.resolve(null),
    bootstrapFlags(session?.user.id ?? 'anonymous'),
  ])
  const hasHousehold = householdId !== null

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta name="x-server-base-url" content={baseURL} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
            <ConsentProvider initialDecision={consentDecision}>
              <Providers
                isAuthenticated={Boolean(session)}
                userId={session?.user.id}
                householdId={householdId}
                bootstrap={bootstrap}
              >
                <Toaster richColors closeButton duration={4000} />
                <Header />
                <main
                  id="main-content"
                  className="mx-auto min-h-screen max-w-[1152px] pt-[calc(4rem+env(safe-area-inset-top,0px))] pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-0"
                >
                  {children}
                </main>
                <Footer />
                <BottomTabBar session={session} hasHousehold={hasHousehold} />
              </Providers>
            </ConsentProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
