# Security Headers

This file covers the response headers: the Content Security Policy and the static headers.

## Security controls documented elsewhere

- **Rate limiting:** `src/lib/rate-limit.ts`; the Upstash setup is in [ENVIRONMENT_SETUP.md § Upstash Redis](./ENVIRONMENT_SETUP.md#upstash-redis-rate-limiting).
- **Session redirect for protected routes:** `src/proxy.ts` (`PROTECTED_PREFIXES`); see CLAUDE.md → Authentication Patterns. It checks the session cookie only; each page still checks the session itself.
- **Cron secret:** [ENVIRONMENT_SETUP.md § Cron secret](./ENVIRONMENT_SETUP.md#cron-secret-account-deletion-purge-weekly-reminders).
- **Destructive-command hook** for agents (`.claude/hooks/block-destructive.mts`): CLAUDE.md → Git & Workflow Essentials → Hooks.
- **Breach response:** [RUNBOOKS/breach-notification.md](./RUNBOOKS/breach-notification.md).
- **OAuth for MCP clients:** [§ OAuth for MCP clients](#oauth-for-mcp-clients) below.

## Content Security Policy (CSP)

The CSP is delivered via Next.js proxy (`src/proxy.ts`) with a per-request nonce for script execution.

### How it works

1. `src/proxy.ts` generates a fresh base64 nonce per request
2. The nonce is forwarded to layouts via the `x-nonce` request header
3. `layout.tsx` reads the nonce and passes it to components that inject inline scripts (e.g., `next-themes`)
4. The CSP header is set on the response with the same nonce

### Directives

| Directive                   | Value                                                         | Reason                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default-src`               | `'self'`                                                      | Only allow resources from the same origin by default                                                                                                                                                                  |
| `script-src`                | `'self' 'nonce-{NONCE}' 'strict-dynamic'`                     | Scripts must be same-origin or carry the per-request nonce. `strict-dynamic` allows nonce-approved scripts to load further scripts (needed for PostHog loader).                                                       |
| `style-src`                 | `'self' 'unsafe-inline'`                                      | Tailwind CSS and CSS-in-JS libraries emit inline styles at build time. Noncing every inline style is impractical. Inline styles are lower XSS risk than scripts — they cannot execute code, only modify presentation. |
| `img-src`                   | `'self' data: blob: https://*.public.blob.vercel-storage.com` | Self-hosted images, data URIs (icons), blob URLs, and generated meal illustrations served from Vercel Blob (HON-734)                                                                                                  |
| `font-src`                  | `'self'`                                                      | Geist fonts are served by `next/font` from the same origin                                                                                                                                                            |
| `connect-src`               | `'self' https://eu.posthog.com`                               | API calls to same origin. PostHog SDK traffic goes through the same-origin `/ingest` rewrite (`next.config.ts`, HON-985); only the PostHog app host stays, for the toolbar's API calls                                |
| `frame-ancestors`           | `'none'`                                                      | Prevents embedding in iframes (clickjacking protection)                                                                                                                                                               |
| `base-uri`                  | `'self'`                                                      | Prevents base tag injection                                                                                                                                                                                           |
| `form-action`               | `'self'`                                                      | Forms can only submit to same origin                                                                                                                                                                                  |
| `object-src`                | `'none'`                                                      | Blocks Flash/Java plugins                                                                                                                                                                                             |
| `upgrade-insecure-requests` | (production only)                                             | Forces HTTPS for all subresources                                                                                                                                                                                     |

### Development mode

In development (`NODE_ENV=development`):

- `'unsafe-eval'` is added to `script-src` for React Fast Refresh
- `'strict-dynamic'` is omitted (conflicts with dev tooling)
- `upgrade-insecure-requests` is omitted (localhost is HTTP)

### Third-party domains

| Domain                                     | Used by                                                                                                                                           | Directive     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `https://eu.posthog.com`                   | PostHog app host (`ui_host`): the toolbar's API calls. The ingest and assets hosts are not listed, because the SDK reaches them through `/ingest` | `connect-src` |
| `https://*.public.blob.vercel-storage.com` | Vercel Blob public URLs for generated meal illustrations; also in `images.remotePatterns` (`next.config.ts`) — keep the two in sync               | `img-src`     |

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

Add the domain to the relevant directive in `src/proxy.ts` `buildCspHeader()`. Document it in the table above.

## Static Headers

Set via `next.config.ts` `headers()` on all routes:

| Header                      | Value                                                                                                           | Purpose                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload`                                                                  | Forces HTTPS for 1 year, includes subdomains, eligible for HSTS preload list                                                            |
| `X-Frame-Options`           | `DENY`                                                                                                          | Legacy clickjacking protection (CSP `frame-ancestors` is the modern equivalent)                                                         |
| `X-Content-Type-Options`    | `nosniff`                                                                                                       | Prevents MIME type sniffing                                                                                                             |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                               | Sends full URL for same-origin, origin-only for cross-origin, nothing for downgrade                                                     |
| `Permissions-Policy`        | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()` | Disables browser features not used by the app                                                                                           |
| `X-DNS-Prefetch-Control`    | `on`                                                                                                            | Enables DNS prefetching for performance                                                                                                 |
| `X-Robots-Tag`              | `noindex, nofollow`, only when `NEXT_PUBLIC_APP_ENV` is not `production`                                        | Keeps staging and preview deployments out of search (HON-1159). `robots.ts` and `sitemap.ts` read the same check, `src/lib/indexing.ts` |

### Headers intentionally omitted

- **`X-XSS-Protection`**: Deprecated. Can cause issues in older browsers (IE). CSP provides superior XSS protection.
- **`Report-To` / `report-uri`**: CSP violation reporting deferred until a consumer (e.g., PostHog dashboard) is ready. Currently would just generate noise.

## OAuth for MCP clients

Wobblepot is an OAuth 2.1 authorization server for MCP clients, such as a custom connector in Claude (HON-1150). The Better Auth `mcp()` plugin in `src/lib/auth.ts` runs it, with the `jwt` plugin for signing keys and the `cimd` plugin for Client ID Metadata Documents.

- **Endpoints.** Under `/api/auth`: `oauth2/authorize`, `oauth2/token`, `oauth2/register`, `oauth2/consent`, `oauth2/userinfo` and `jwks`. Discovery is at the origin root, because the issuer is the bare origin: `/.well-known/oauth-authorization-server` (RFC 8414) and `/.well-known/oauth-protected-resource`, also at `/.well-known/oauth-protected-resource/api/mcp` (RFC 9728). They are public JSON with `Access-Control-Allow-Origin: *`. The proxy adds its CSP to them as to every route; a JSON response runs no script, so the CSP needs no change.
- **Tokens.** PKCE with `S256` is required. An access token is a JWT for the audience `<origin>/api/mcp`, valid for 1 hour, signed with a key from the `jwks` table, whose private key is encrypted with `BETTER_AUTH_SECRET`. With `offline_access` the client also gets a refresh token, valid for 30 days and rotated on each use; a retry within 30 seconds gets the same response.
- **Consent.** A signed-in user allows or denies the client on `/consent`. The page checks the signature and expiry of the query before it shows the client's name. Consents are stored in `oauth_consent`, tokens in `oauth_access_token` and `oauth_refresh_token`. All three cascade on user deletion. A client row in `oauth_client` stays, with `userId` cleared.
- **Registration is open.** Dynamic client registration accepts unauthenticated requests, because Claude registers that way, and a Client ID Metadata Document is fetched with the plugin's Node transport, which resolves the host once, accepts only public addresses and follows no redirects. Anyone can create a client row, but a client reads nothing until a user allows it. Better Auth's built-in rate limiter covers these endpoints. There is no Upstash bucket: Claude registers from shared Anthropic addresses, so a per-IP limit would block every household after a few connections.
