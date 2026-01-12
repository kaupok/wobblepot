import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'
import { ThemeProvider } from '@/components/theme-provider'
import { Header } from '@/components/header'
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

export const metadata: Metadata = {
  title: 'Honkadori',
  description: 'Honkadori all day',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const baseURL = getServerBaseURL()

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="x-server-base-url" content={baseURL} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Toaster richColors closeButton duration={4000} />
          <Header />
          <main id="main-content" className="min-h-screen pt-16">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  )
}
