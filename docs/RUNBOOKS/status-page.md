# Public status page

Operator runbook for the `/status` page introduced in HON-489.

## What the page is

- **URL:** `/status` — public, no sign-in required, allow-listed in `src/app/robots.ts`.
- **Audience:** users self-diagnosing "is it me or them?" during an outage, plus on-call during incident response.
- **What it shows:** up/down state for three components — AI pipeline, auth, database — plus an optional incident banner.

The page is a thin view on top of live probes. It is **not** a historical incident archive; for that, see the Linear incident log.

## How the probes are wired

| Component | Code                                              | Check                                                                                          |
| --------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Database  | [`probeDatabase`](../../src/lib/status/probes.ts) | `prisma.$queryRaw'SELECT 1'`, 2s timeout. Mirrors `/api/health` (HON-454).                     |
| Auth      | [`probeAuth`](../../src/lib/status/probes.ts)     | `prisma.session.count()`, 2s timeout. Exercises the table Better Auth reads.                   |
| AI        | [`probeAi`](../../src/lib/status/probes.ts)       | `generateObject` against `claude-haiku-4-5` with a trivial `{ ok: true }` schema, 10s timeout. |

All three probes are cached in-memory for **60 seconds** per serverless instance. That is the steady-state cost ceiling:

- AI probe runs at most once/minute/instance regardless of page traffic.
- At Haiku pricing with a tiny prompt and response, one probe costs well under $0.001. Even if every Vercel instance stays warm and probes once per minute for a full day, the daily probe cost is below a dollar.

The probe result cache is separate from Next.js route caching. `/status` is `force-dynamic` so every request sees fresh probe data (or the 60s cached result).

## Probe-driven vs manual override

The default and preferred mode is **probe-driven**: the green/red state you see on `/status` is what the probes observed in the last 60 seconds.

Manual override is intentionally limited to a single knob: an **incident banner** surfaced at the top of the page. The per-component state is always probe-driven — we do not have a "force this component down" switch on purpose, so ops can never disagree with reality about what is actually responding.

### When to use the incident banner

Set `STATUS_INCIDENT_MESSAGE` when any of the following is true and the probes do not already tell the full story:

- A known upstream provider is having an outage (Anthropic regional issue, Neon compute endpoint degraded, Resend mail queue stuck) but the probe hasn't flipped yet — latency is high, retries are masking, or the incident is intermittent.
- We are taking planned maintenance: a scheduled migration that will briefly take the DB offline, a deploy window, a security patch rolling through.
- The root cause is outside our probes: users reporting issues with a feature we do not probe (shopping list generation, email delivery, a specific recipe flow).
- A customer communication is needed: "We are investigating reports of meal plan generation failures. Updates on this page."

Do **not** set it for:

- Trivial latency spikes that probes handle on their own.
- Internal-only issues users cannot see.
- Speculative concerns — wait until the problem is confirmed before telling users about it.

### Setting the banner via Vercel

```bash
# Set, update, or remove the banner on production. Prefers the Vercel CLI so
# the env change goes through audit logs; the web UI works too.
vercel env add STATUS_INCIDENT_MESSAGE production
# Paste the message when prompted. Then redeploy — env changes do not hot-reload.
vercel --prod

# To clear the banner:
vercel env rm STATUS_INCIDENT_MESSAGE production
vercel --prod
```

The redeploy takes 1–3 minutes. The banner appears on `/status` as soon as the new deployment is live; no cache invalidation needed because the page is `force-dynamic`.

### Writing the banner copy

Keep the tone consistent with the support email (HON-487) and the breach notification template (HON-482):

- Plain language. No jargon or acronyms.
- State **what** is affected in user-visible terms ("Meal plan generation") rather than system terms ("Anthropic API 529").
- State **what we are doing** ("We are investigating"). Do not over-promise ETAs unless one is concrete.
- Close with the support email: `support@honkadori.xyz`.

Example:

> Meal plan generation is currently intermittent. We are investigating and will update this page as the situation evolves. If you need help in the meantime, email support@honkadori.xyz.

## During an incident

1. Confirm the issue. `/status` and `/api/health` are authoritative for DB; Vercel logs and the Anthropic console confirm AI.
2. If probes do not yet reflect reality or extra context is needed, set `STATUS_INCIDENT_MESSAGE` (see above). This is a deploy, so the clock includes the deploy time.
3. Update the message as the situation evolves (each update is another deploy).
4. Clear the message when resolved.
5. Write the incident summary in the Linear incident log. Cross-link the breach runbook (`docs/RUNBOOKS/breach-notification.md`, HON-482) if any personal data was exposed — the thresholds are different and stricter than a generic outage.

## Cross-references

- **[`src/app/api/health/route.ts`](../../src/app/api/health/route.ts)** (HON-454) — uptime-monitor-facing endpoint with 200/503 semantics. Distinct from `/api/status`, which always returns 200 and carries the state in the payload.
- **HON-484** — uptime monitoring configured against `/api/health`.
- **HON-487** — support email definition (shipped). The `SUPPORT_EMAIL` constant lives in [`src/lib/support.ts`](../../src/lib/support.ts); `/status` and the rest of the surfaces import from there. Triage and SLAs are documented in [`dsr-intake.md`](./dsr-intake.md).
- **HON-482** — breach notification runbook. Status-page copy and the breach email template should share tone and the same support contact.
