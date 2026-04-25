# Feature flags

PostHog-backed kill-switches and (eventually) experiment flags. The infrastructure was added in HON-477 on top of the PostHog foundation from HON-474.

## Why we have flags

Solo-dev with an agentic workflow — a bad generation of code can reach production fast. Flags give us an off-switch that isn't `git revert`. The launch-day flags are all kill-switches: a single dashboard toggle disables a feature without a deploy.

Experiment flags (variant / multivariate) are not in scope at launch — only safety valves.

## The three launch-day kill-switches

All three default to `true` (the safe value). A PostHog outage keeps the product running and `invite_code_required` keeps sign-up locked down.

| Flag                    | Default | What flipping to `false` does                                                                                                                          |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ai_generation_enabled` | `true`  | `/api/meal-plans/generate` returns 503 without hitting Anthropic. Use during an Anthropic outage, a runaway-cost incident, or a bad prompt regression. |
| `recipe_import_enabled` | `true`  | `/api/recipes/parse` returns 503. Use to disable the highest-risk external-input surface (SSRF, parser crashes, non-recipe content) without a deploy.  |
| `invite_code_required`  | `true`  | `/sign-up` no longer requires a `SignupCode`. Flip from `true → false` when opening sign-up to the public; flip back to lock down. (Wired in HON-488.) |

## Reading a flag (server)

```ts
import { getServerFlag } from '@/lib/feature-flags'

const enabled = await getServerFlag('ai_generation_enabled', session.user.id)
if (!enabled) {
  return NextResponse.json(
    { error: 'AI generation is temporarily disabled', message: '...' },
    { status: 503 },
  )
}
```

`getServerFlag` is the only sanctioned way to read a flag server-side. It:

- accepts only typed `FlagKey` values — passing an unknown string is a TypeScript error;
- races the PostHog `getFeatureFlag` call against a 100ms timeout;
- returns `FLAG_DEFAULTS[key]` (the safe default) on timeout, error, or `undefined` from PostHog;
- never throws, never propagates a PostHog error to the caller, never logs to PostHog itself (storming the very dashboard we're trying to read from is the wrong move during an outage — `console.warn` only).

When no session is available, pass the literal string `'anonymous'` as the distinct id. That's fine for kill-switches; true A/B testing on anonymous users would need a stable cookie-based id (future concern).

## Reading a flag (client)

The server evaluates every known flag during `RootLayout` rendering and passes a `BootstrapData` payload through `<Providers>` → `<PostHogProvider>` → `posthog.init({ bootstrap })`. That means once the SDK is loaded, `usePostHog().isFeatureEnabled('ai_generation_enabled')` returns the bootstrapped value synchronously — no flash of wrong variant during hydration.

Reads on **post-consent** surfaces:

```tsx
'use client'
import { usePostHog } from '@posthog/react'

export function ImagineButton() {
  const posthog = usePostHog()
  const enabled = posthog?.isFeatureEnabled('ai_generation_enabled') ?? true // safe default
  return enabled ? <Button>...</Button> : null
}
```

Reads on **pre-consent** surfaces (marketing pages, the consent banner itself, the sign-up form): the SDK never initialises before consent, so client-side `posthog.isFeatureEnabled()` returns nothing. Server-evaluate the flag in the RSC and either pass the result down as a prop or skip the client-side flag check entirely. None of the launch flags are read client-side, so this isn't an issue today.

## Adding a new flag

1. Add the key to the `FlagKey` union in `src/lib/feature-flags.ts`.
2. Add an entry to `FLAG_DEFAULTS` with the **safe** value (think: which value should the flag take if PostHog is down at 2am?).
3. Create the flag in **all three** PostHog projects (`mealplan-production`, `mealplan-staging`, `mealplan-development`) under the `Honkadori` org with the same default.
4. For an experiment / product flag (not a kill-switch): set an owner and an expected resolution date in PostHog at creation time. Kill-switches are exempt — they stay forever by design.
5. Read it via `getServerFlag(key, distinctId)` server-side, or `usePostHog().isFeatureEnabled(key)` client-side (post-consent only).

## Fail-open default

Every flag has a default in `FLAG_DEFAULTS`. That value is what the helper returns when:

- the PostHog env vars are unset (local dev / unprovisioned environments — `getPosthogServer()` returns `null`);
- the PostHog request times out (>100ms);
- PostHog rejects the request;
- the flag isn't configured yet in PostHog (returns `undefined`);
- PostHog returns a multivariate string we don't model as a boolean.

All five of these collapse to the same answer: the safe default. The explicit toggle in the PostHog dashboard is what changes behaviour — the absence of a response never does.

For kill-switches, "safe" = `true`. The product stays up; the lock-down stays locked. For an experiment flag, "safe" usually means the control variant — pick deliberately when adding it.

## Cleanup policy

- **Kill-switches** stay forever by design — they're insurance.
- **Experiment / product flags** must have an owner and an expected resolution date captured in PostHog. Once the experiment ships (or is killed), retire the flag and remove the code path within one release.

## Gotchas

- **Latency telemetry.** A frequent 100ms timeout in production is a signal that PostHog's EU region is slow for us, not a flag-check bug. Watch via PostHog ingest latency metrics — not via our error tracker (which would itself depend on PostHog).
- **Server-eval bypasses consent — by design.** `getServerFlag` uses `posthog-node` directly. Cap-style kill-switches must work for every request regardless of the user's analytics-consent choice. No PII is leaked: only `distinctId` and the flag key go to PostHog.
- **Bootstrap reaches the client only after consent.** The client SDK is gated on consent. Pre-consent UI cannot read flags client-side; server-evaluate and pass down as props instead.
- **Short-circuit before the work the kill-switch is meant to skip.** Place the flag check before the AI call and any AI-specific cost-cap or quota check, so a disabled feature does no expensive work. Auth, household lookup, and rate-limit checks still run first — they're cheap, they apply regardless, and rate-limiting still matters even when the feature is off (it stops a flood of 503s from a misbehaving client).
