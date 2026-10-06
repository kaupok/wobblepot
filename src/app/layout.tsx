import type { Metadata, Viewport } from 'next'
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
import { geistMono, geistSans } from '@/lib/fonts'
import Providers from '@/app/providers'
import '@/lib/env'
import { getServerBaseURL } from '@/lib/env'

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
  const [t, locale] = await Promise.all([getTranslations('meta.root'), getLocale()])
  const title = t('title')
  const titleTemplate = t('titleTemplate')
  const description = t('description')
  const ogTitle = t('ogTitle')
  const ogDescription = t('ogDescription')

  return {
    metadataBase: new URL(getServerBaseURL()),
    title: { default: title, template: titleTemplate },
    description,
    // No `images` here on purpose (HON-483): `src/app/opengraph-image.tsx`
    // emits `og:image`, `og:image:type|width|height` and `twitter:image` via
    // the file convention. An `images` entry here would *suppress* it, not
    // duplicate it — `mergeStaticMetadata` merges the file-based image only
    // when this segment's own metadata has no `images` key
    // (`next/dist/lib/metadata/resolve-metadata.js:148`) — leaving whatever
    // manual URL was written here as the only og:image tag. That is exactly
    // how `/og-image.png`, a file that never existed, was the one tag served.
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url: '/',
      siteName: title,
      type: 'website',
      locale: toOgLocale(locale),
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: ogDescription,
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
  // the message catalog resolve independently. `getLocale`
  // (`@/lib/i18n/get-locale`) is not itself cached — what makes this safe is
  // that the `getSession()` it calls is `cache()`-wrapped in `@/lib/session`.
  // So this direct call, `getLocale`'s, and `getMessages()`'s (which re-enters
  // `getLocale` via `src/lib/i18n/request.ts`) share one in-flight auth lookup.
  const [session, consentDecision, locale, messages, tToaster] = await Promise.all([
    getSession(),
    readConsentCookieServer(),
    getLocale(),
    getMessages(),
    getTranslations('common.toaster'),
  ])

  // Both of these need the resolved session, but not each other — the
  // household lookup and the flag bootstrap (PostHog round-trip) overlap. The
  // household lookup shares `getCachedMembership` with `getLocale` above and
  // with `<Header />` below, so it is a cache hit rather than a second query.
  // Feature flags are evaluated server-side so PostHog's client SDK can answer
  // `isFeatureEnabled` synchronously on first render. The evaluation is cached
  // per request and for 30 s per distinct id, and an anonymous `getServerFlag`
  // read in the page shares it, so a landing render makes one `/flags` request.
  // It fails open to `FLAG_DEFAULTS`, so this never throws and never blocks the page.
  const [householdId, bootstrap] = await Promise.all([
    session ? getHouseholdIdForUser(session.user.id) : Promise.resolve(null),
    bootstrapFlags(session?.user.id ?? 'anonymous'),
  ])
  const hasHousehold = householdId !== null

  // `meta.admin` is read only by the admin pages' server-side `generateMetadata`,
  // and `nav.admin` only by `Header`, which resolves the admin menu links on the
  // server. Left in the client catalog, either would ship in every page's HTML
  // — 404s included — and name the hidden admin route (HON-830, HON-1092).
  const { admin: _adminMeta, ...clientMeta } = messages.meta ?? {}
  const { admin: _adminNav, ...clientNav } = messages.nav ?? {}
  const clientMessages = { ...messages, meta: clientMeta, nav: clientNav }

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="x-server-base-url" content={baseURL} />
      </head>
      <body className="antialiased">
        <NextIntlClientProvider locale={locale} messages={clientMessages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
            nonce={nonce}
          >
            <ConsentProvider
              initialDecision={consentDecision}
              hasTabBar={Boolean(session) && hasHousehold}
            >
              <Providers
                isAuthenticated={Boolean(session)}
                userId={session?.user.id}
                householdId={householdId}
                bootstrap={bootstrap}
              >
                {/* Sonner's own labels ("Notifications", "Close toast") are English. */}
                <Toaster
                  richColors
                  closeButton
                  duration={4000}
                  containerAriaLabel={tToaster('label')}
                  toastOptions={{ closeButtonAriaLabel: tToaster('close') }}
                />
                <Header />
                <main
                  id="main-content"
                  className="max-w-page mx-auto min-h-screen pt-[calc(4.5rem+env(safe-area-inset-top,0px))] pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-0"
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
