# Security Headers

## Content Security Policy (CSP)

The CSP is delivered via Next.js middleware (`middleware.ts`) with a per-request nonce for script execution.

### How it works

1. `middleware.ts` generates a fresh base64 nonce per request
2. The nonce is forwarded to layouts via the `x-nonce` request header
3. `layout.tsx` reads the nonce and passes it to components that inject inline scripts (e.g., `next-themes`)
4. The CSP header is set on the response with the same nonce

### Directives

| Directive                   | Value                                                   | Reason                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default-src`               | `'self'`                                                | Only allow resources from the same origin by default                                                                                                                                                                  |
| `script-src`                | `'self' 'nonce-{NONCE}' 'strict-dynamic'`               | Scripts must be same-origin or carry the per-request nonce. `strict-dynamic` allows nonce-approved scripts to load further scripts (needed for PostHog loader).                                                       |
| `style-src`                 | `'self' 'unsafe-inline'`                                | Tailwind CSS and CSS-in-JS libraries emit inline styles at build time. Noncing every inline style is impractical. Inline styles are lower XSS risk than scripts — they cannot execute code, only modify presentation. |
| `img-src`                   | `'self' data: blob: https://*.posthog.com`              | Self-hosted images, data URIs (icons), blob URLs, and PostHog autocapture pixels                                                                                                                                      |
| `font-src`                  | `'self'`                                                | Geist fonts are served by `next/font` from the same origin                                                                                                                                                            |
| `connect-src`               | `'self' https://*.posthog.com https://eu.i.posthog.com` | API calls to same origin, PostHog event ingest (EU region)                                                                                                                                                            |
| `frame-ancestors`           | `'none'`                                                | Prevents embedding in iframes (clickjacking protection)                                                                                                                                                               |
| `base-uri`                  | `'self'`                                                | Prevents base tag injection                                                                                                                                                                                           |
| `form-action`               | `'self'`                                                | Forms can only submit to same origin                                                                                                                                                                                  |
| `object-src`                | `'none'`                                                | Blocks Flash/Java plugins                                                                                                                                                                                             |
| `upgrade-insecure-requests` | (production only)                                       | Forces HTTPS for all subresources                                                                                                                                                                                     |

### Development mode

In development (`NODE_ENV=development`):

- `'unsafe-eval'` is added to `script-src` for React Fast Refresh
- `'strict-dynamic'` is omitted (conflicts with dev tooling)
- `upgrade-insecure-requests` is omitted (localhost is HTTP)

### Third-party domains

| Domain                     | Used by                                         | Directive                |
| -------------------------- | ----------------------------------------------- | ------------------------ |
| `https://*.posthog.com`    | PostHog analytics (autocapture pixels + ingest) | `img-src`, `connect-src` |
| `https://eu.i.posthog.com` | PostHog EU ingest endpoint                      | `connect-src`            |

### Adding a new script source

**Do NOT** add domains to `script-src` or use `'unsafe-inline'`. Instead:

1. Read the nonce from the `x-nonce` header in your server component
2. Pass it to the `<Script nonce={nonce}>` component from `next/script`
3. The nonce + `'strict-dynamic'` will allow the script and any scripts it loads

Example:

```tsx
import Script from 'next/script'
import { headers } from 'next/headers'

export default async function Page() {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return <Script src="https://example.com/script.js" nonce={nonce} />
}
```

### Adding a new connect/image source

Add the domain to the relevant directive in `middleware.ts` `buildCspHeader()`. Document it in the table above.

## Static Headers

Set via `next.config.ts` `headers()` on all routes:

| Header                      | Value                                                                                                           | Purpose                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload`                                                                  | Forces HTTPS for 1 year, includes subdomains, eligible for HSTS preload list        |
| `X-Frame-Options`           | `DENY`                                                                                                          | Legacy clickjacking protection (CSP `frame-ancestors` is the modern equivalent)     |
| `X-Content-Type-Options`    | `nosniff`                                                                                                       | Prevents MIME type sniffing                                                         |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                               | Sends full URL for same-origin, origin-only for cross-origin, nothing for downgrade |
| `Permissions-Policy`        | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()` | Disables browser features not used by the app                                       |
| `X-DNS-Prefetch-Control`    | `on`                                                                                                            | Enables DNS prefetching for performance                                             |

### Headers intentionally omitted

- **`X-XSS-Protection`**: Deprecated. Can cause issues in older browsers (IE). CSP provides superior XSS protection.
- **`Report-To` / `report-uri`**: CSP violation reporting deferred until a consumer (e.g., PostHog dashboard) is ready. Currently would just generate noise.
