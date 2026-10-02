import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { postHogRewrites } from './src/lib/posthog-proxy'

const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts')

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // Required for posthog-cli sourcemap inject/upload — without it, Next.js
  // doesn't emit browser-readable .map files in production and the CLI
  // walks an empty directory. Tradeoff: source is visible in devtools for
  // anyone who looks. See docs/ENVIRONMENT_SETUP.md § "PostHog".
  productionBrowserSourceMaps: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    // Generated meal images live in Vercel Blob (HON-734). Each store has its
    // own subdomain and staging/production use different stores, hence the
    // wildcard. Keep in sync with `img-src` in src/proxy.ts.
    remotePatterns: [{ protocol: 'https', hostname: '*.public.blob.vercel-storage.com' }],
  },
  // PostHog requests end in `/` (e.g. `/ingest/e/`), and the default redirect
  // would strip it before the rewrite below forwards the request.
  skipTrailingSlashRedirect: true,
  // Same-origin reverse proxy for the PostHog browser SDK, which PostHog's
  // Installation Health check asks for: ad blockers match the PostHog hosts,
  // not `/ingest` on our origin (HON-985). See src/lib/posthog-proxy.ts.
  async rewrites() {
    return postHogRewrites(process.env.NEXT_PUBLIC_POSTHOG_HOST)
  },
  async redirects() {
    return [
      {
        source: '/household/household',
        destination: '/household',
        permanent: true,
      },
      {
        source: '/household/members',
        destination: '/household',
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()',
          },
        ],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
