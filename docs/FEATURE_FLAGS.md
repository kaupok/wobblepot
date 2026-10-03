# Feature flags

PostHog-backed kill-switches and (eventually) experiment flags. The infrastructure was added in HON-477 on top of the PostHog foundation from HON-474.

## Why we have flags

Solo-dev with an agentic workflow — a bad generation of code can reach production fast. Flags give us an off-switch that isn't `git revert`. The launch-day flags are all kill-switches: a single dashboard toggle disables a feature without a deploy.

Experiment flags (variant / multivariate) are not in scope at launch — only safety valves.

## The three launch-day kill-switches

All three default to `true` (the safe value). A PostHog outage keeps the product running and `invite_code_required` keeps sign-up locked down.

| Flag                    | Default | What flipping to `false` does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_generation_enabled` | `true`  | No route makes a model call (Anthropic or OpenAI). Returns 503 from `/api/meal-plans/generate`, `/api/meals/imagine`, `/api/meals/imagine/review` (the client keeps the unreviewed meal), the preparation-tips generation under `/api/meal-plans/[id]/entries/[entryId]/preparation-tips`, the image generation in `POST /api/meals/[id]/image`, and `/api/recipes/parse` (as `import_disabled`, so a full stop of recipe import needs nothing extra). Still working with it off: stored preparation tips, existing meal images and `GET /api/meals/[id]/image`, swap suggestions and regenerate (they rank database candidates), and the `probeAi` status probe, which is how you see the provider come back. Use during a provider outage, a runaway-cost incident, or a bad prompt regression. |
| `recipe_import_enabled` | `true`  | `/api/recipes/parse` returns 503. The narrower switch: disables the highest-risk external-input surface (SSRF, parser crashes, non-recipe content) without a deploy, and leaves the other AI routes running.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `invite_code_required`  | `true`  | `/sign-up` no longer requires a `SignupCode`. Flip from `true → false` when opening sign-up to the public; flip back to lock down. Wired into Better Auth's request-level `hooks.before` middleware (HON-488).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

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
- races the PostHog call against a 100ms timeout: `getFeatureFlag` for a user id, the cached `getAllFlags` evaluation for `'anonymous'` (see [Caching](#caching));
- returns `FLAG_DEFAULTS[key]` (the safe default) on timeout, error, or `undefined` from PostHog;
- never throws, never propagates a PostHog error to the caller, never logs to PostHog itself (storming the very dashboard we're trying to read from is the wrong move during an outage — `console.warn` only).

When no session is available, pass the literal string `'anonymous'` as the distinct id. That's fine for kill-switches; true A/B testing on anonymous users would need a stable cookie-based id (future concern).

## Reading a flag (client)

The server evaluates every known flag during `RootLayout` rendering and passes a `BootstrapData` payload through `<Providers>` → `<PostHogProvider>` → `posthog.init({ bootstrap })`. That means once the SDK is loaded, `isFeatureEnabled('ai_generation_enabled')` returns the bootstrapped value synchronously — no flash of wrong variant during hydration.

Reads on **post-consent** surfaces go through `getLoadedPostHog()` (`src/lib/posthog-client-state.ts`), which resolves to `null` until the SDK has initialised:

```ts
import { getLoadedPostHog } from '@/lib/posthog-client-state'

const posthog = await getLoadedPostHog()
const enabled = posthog?.isFeatureEnabled('ai_generation_enabled') ?? true // safe default
```

Do not import `posthog-js` or `@posthog/react` statically in client code. Either one puts the whole SDK in the initial JS of every visitor, including users who declined analytics (HON-999). `@posthog/react` is not a dependency for that reason, and `src/lib/posthog-bundle-boundary.test.ts` fails CI on a static import.

Reads on **pre-consent** surfaces (marketing pages, the consent banner itself, the sign-up form): the SDK never initialises before consent, so client-side `posthog.isFeatureEnabled()` returns nothing. Server-evaluate the flag in the RSC and either pass the result down as a prop or skip the client-side flag check entirely. None of the launch flags are read client-side, so this isn't an issue today.

## Caching

`bootstrapFlags` and anonymous `getServerFlag` reads share one `getAllFlags` evaluation per distinct id, held in two caches:

- **Per request:** React `cache()`. The layout bootstrap and the landing or `/sign-up` page read of `invite_code_required` make one `/flags` request together, not two.
- **Per distinct id, for 30 s (`FLAG_CACHE_TTL_MS`):** an in-memory map in each warm Vercel function instance. Repeat renders by the same user, or by any anonymous visitor, inside that window make no request. Outside a React render (route handlers, the Better Auth sign-up hook) this map is the only cache.

A timeout or an error is not cached, so the next read asks PostHog again. posthog-node reports a failed request as an empty result (`{}`) rather than a rejection, so an empty result counts as an error. Server reads with a user id (the API-route kill-switches) are not cached: each one calls `getFeatureFlag`, because that call sends the `$feature_flag_called` event PostHog uses to show a flag as active. `getAllFlags` sends none.

**Kill-switch delay.** A flip in PostHog reaches the API-route reads on the next request. It reaches the bootstrap and the anonymous reads (`invite_code_required` on `/`, `/sign-up` and the sign-up hook) within 30 s. Each function instance holds its own copy, so two instances can disagree for up to that window.

## Adding a new flag

1. Add the key to the `FlagKey` union in `src/lib/feature-flags.ts`.
2. Add an entry to `FLAG_DEFAULTS` with the **safe** value (think: which value should the flag take if PostHog is down at 2am?).
3. Create the flag in **all three** PostHog projects (`mealplan-production`, `mealplan-staging`, `mealplan-development`) under the `Honkadori` org with the same default.
4. For an experiment / product flag (not a kill-switch): set an owner and an expected resolution date in PostHog at creation time. Kill-switches are exempt — they stay forever by design.
5. Read it via `getServerFlag(key, distinctId)` server-side, or `(await getLoadedPostHog())?.isFeatureEnabled(key)` client-side (post-consent only).

## Fail-open default

Every flag has a default in `FLAG_DEFAULTS`. That value is what the helper returns when:

- the PostHog env vars are unset (local dev / unprovisioned environments — `getPosthogServer()` returns `null`);
- the PostHog request times out (>100ms);
- PostHog rejects the request;
- the flag isn't configured yet in PostHog (returns `undefined`);
- PostHog returns a multivariate string we don't model as a boolean.

All five of these collapse to the same answer: the safe default. The explicit toggle in the PostHog dashboard is what changes behaviour — the absence of a response never does.

For kill-switches, "safe" = `true`. The product stays up; the lock-down stays locked. For an experiment flag, "safe" usually means the control variant — pick deliberately when adding it.

## Stale badge

PostHog marks a flag STALE when it has received no `$feature_flag_called` event for 30 days. Only a `getServerFlag` read with a user id sends that event. The layout bootstrap uses `getAllFlags`, which sends none, so it does not count. Reads with the `'anonymous'` id send none either (HON-993), and `invite_code_required` is only read that way: on `/`, on `/sign-up` and in the sign-up hook. So a kill-switch goes STALE when no signed-in user reaches a route that reads it for 30 days. `recipe_import_enabled` went STALE on staging that way, because only `POST /api/recipes/parse` reads it.

- STALE on a kill-switch is a usage signal, not a cleanup signal. The flag still works.
- Do not archive or remove a kill-switch for this reason. The flags in this file are permanent operational flags (see [Cleanup policy](#cleanup-policy)).
- Expect it on staging and development, where traffic is low, and on `invite_code_required` in every project, production included.

## Cleanup policy

- **Kill-switches** stay forever by design — they're insurance.
- **Experiment / product flags** must have an owner and an expected resolution date captured in PostHog. Once the experiment ships (or is killed), retire the flag and remove the code path within one release.

### Retiring an env-var flag

Some gates are plain environment variables validated in `src/lib/env.ts` — a temporary `FEATURE_*` that waits on a migration or a data backfill, an E2E bypass — rather than PostHog flags. Unlike a PostHog kill-switch, these are meant to be **removed once their condition is met**: a left-behind env flag is dead config that drifts between the codebase and the Vercel / CI dashboards.

Retire one in a single PR for the code side, and don't forget the deploy targets for the ops side:

- [ ] `src/lib/env.ts` — the Zod schema entry **and** the `serverEnv` proxy mapping line.
- [ ] `.env.example` — the documented placeholder.
- [ ] Every read (`serverEnv.FEATURE_…`) and the tests that exercised the gate.
- [ ] Docs that describe the gate — grep the flag name across `docs/`.
- [ ] **Vercel → Settings → Environment Variables**, in _every_ environment (Production / Preview / Development, plus the custom `staging` environment). This is the step with no code-review trigger, so it falls on the PR author / merger — call it out explicitly in the PR description.
- [ ] GitHub Actions secrets / variables, if any workflow injected it (grep `.github/`).
- [ ] `pnpm env:audit` — confirms nothing is left behind in Vercel. It should report zero findings once the retirement is complete; the flag showing up as `ORPHAN` means the dashboard step above was missed. See docs/ENVIRONMENT_SETUP.md § "Drift audit".

Removing it from `env.ts` is safe even while a stale value still sits in Vercel: `serverEnv` validates lazily, per accessed key, against an allowlist, so an unread var is inert and can't throw at boot. That's a convenience for ordering the cleanup — not a reason to skip the dashboard step. `pnpm env:audit` (HON-550) is the automated backstop: CI runs it with `--strict` on every PR, so a Vercel-side orphan fails the `Vercel env-var drift audit` job and a missed dashboard step surfaces instead of rotting. (The check is not a required one until HON-584, so red does not block the merge.)

## Gotchas

- **Latency telemetry.** A frequent 100ms timeout in production is a signal that PostHog's EU region is slow for us, not a flag-check bug. Watch via PostHog ingest latency metrics — not via our error tracker (which would itself depend on PostHog).
- **Server-eval bypasses consent — by design.** `getServerFlag` uses `posthog-node` directly. Cap-style kill-switches must work for every request regardless of the user's analytics-consent choice. No PII is leaked: only `distinctId` and the flag key go to PostHog.
- **Bootstrap reaches the client only after consent.** The client SDK is gated on consent. Pre-consent UI cannot read flags client-side; server-evaluate and pass down as props instead.
- **Short-circuit before the work the kill-switch is meant to skip.** Place the flag check before the AI call and any AI-specific cost-cap or quota check, so a disabled feature does no expensive work. Auth, household lookup, and rate-limit checks still run first — they're cheap, they apply regardless, and rate-limiting still matters even when the feature is off (it stops a flood of 503s from a misbehaving client).
