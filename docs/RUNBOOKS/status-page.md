# Public status page

Operator runbook for the `/status` page introduced in HON-489.

## What the page is

- **URL:** `/status` — public, no sign-in required, allow-listed in `src/app/robots.ts`.
- **Audience:** users self-diagnosing "is it me or them?" during an outage, plus on-call during incident response.
- **What it shows:** up/down state for four components — AI pipeline, auth, database, rate limiting — plus an optional incident banner.

The page is a thin view on top of live probes. It is **not** a historical incident archive; for that, see the Linear incident log.

## How the probes are wired

| Component     | Code                                               | Check                                                                                                                                                     |
| ------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database      | [`probeDatabase`](../../src/lib/status/probes.ts)  | `prisma.$queryRaw'SELECT 1'`, 2s timeout. Mirrors `/api/health` (HON-454).                                                                                |
| Auth          | [`probeAuth`](../../src/lib/status/probes.ts)      | `prisma.session.count()`, 2s timeout. Exercises the table Better Auth reads.                                                                              |
| Rate limiting | [`probeRateLimit`](../../src/lib/status/probes.ts) | Upstash Redis `PING`, 2s timeout. A failure means abuse protection is off, not that the product is down, so it surfaces as `degraded` rather than `down`. |
| AI            | [`probeAi`](../../src/lib/status/probes.ts)        | `generateObject` against `claude-haiku-4-5` with a trivial `{ ok: true }` schema, 10s timeout.                                                            |

All four probes are cached in-memory for **60 seconds** per serverless instance. That is the steady-state cost ceiling:

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

Two steps: change the variable, then redeploy the live Production deployment so it reads the new value. Env changes do not hot-reload.

**1. Change the variable.** The CLI is preferred so the change goes through the audit log; the dashboard's Settings → Environment Variables works too. These commands change the environment only and do not deploy.

```bash
# Set the banner. Paste the message when prompted.
vercel env add STATUS_INCIDENT_MESSAGE production

# Update the message: `env add` refuses a variable that already exists, so remove it first.
vercel env rm STATUS_INCIDENT_MESSAGE production
vercel env add STATUS_INCIDENT_MESSAGE production

# Clear the banner.
vercel env rm STATUS_INCIDENT_MESSAGE production
```

**2. Redeploy the current Production deployment.** Set, update and clear all end here:

1. Vercel dashboard → the project → Deployments.
2. Open the deployment marked **Current** in the Production environment.
3. "⋯" → **Redeploy**. In the dialog, **uncheck "Use project's Ignore Build Step"**. The project's Ignored Build Step cancels every build with `VERCEL_ENV=production` ([`DEPLOYMENT.md` → Vercel Configuration](../DEPLOYMENT.md#vercel-configuration)), so a redeploy with the box checked ends `CANCELED` and the banner never appears.

A redeploy rebuilds the commit that is already live with the new environment, so the code does not change. Do **not** deploy from a checkout with the CLI (`vercel deploy --prod`): it builds and ships whatever files are on that laptop, feature branch and uncommitted work included. Do not run the `Deploy code [production]` workflow for this either: it ships `main` HEAD, which can be ahead of what is live and of its migrations.

The redeploy writes no GitHub deployment record, and none is needed: the commit is unchanged, so the existing record is still correct. A rollback is different. Its dashboard promote does change the commit, and the record has to be corrected by hand (see [`DEPLOYMENT.md` → Rollback Procedure](../DEPLOYMENT.md#rollback-procedure)).

This path has not yet been exercised on this project. The status-banner drill in HON-871 runs it once; if the redeploy still ends `CANCELED` there, correct this section.

The redeploy takes 1–3 minutes. The banner appears on `/status` as soon as the new deployment is live; no cache invalidation needed because the page is `force-dynamic`.

### Writing the banner copy

Keep the tone consistent with the support email (HON-487) and the breach notification template (HON-482):

- Plain language. No jargon or acronyms.
- State **what** is affected in user-visible terms ("Meal plan generation") rather than system terms ("Anthropic API 529").
- State **what we are doing** ("We are investigating"). Do not over-promise ETAs unless one is concrete.
- Close with the support email: `support@wobblepot.com`.

Example:

> Meal plan generation is currently intermittent. We are investigating and will update this page as the situation evolves. If you need help in the meantime, email support@wobblepot.com.

## During an incident

1. Confirm the issue. `/status` and `/api/health` are authoritative for DB; Vercel logs and the Anthropic console confirm AI.
2. If probes do not yet reflect reality or extra context is needed, set `STATUS_INCIDENT_MESSAGE` (see above). It takes a redeploy, so the clock includes the redeploy time.
3. Update the message as the situation evolves (each update is another redeploy).
4. Clear the message when resolved, and redeploy.
5. Write the incident summary in the Linear incident log. Cross-link the breach runbook (`docs/RUNBOOKS/breach-notification.md`, HON-482) if any personal data was exposed — the thresholds are different and stricter than a generic outage.

## Cross-references

- **[`src/app/api/health/route.ts`](../../src/app/api/health/route.ts)** (HON-454) — uptime-monitor-facing endpoint with 200/503 semantics. Distinct from `/api/status`, which always returns 200 and carries the state in the payload.
- **HON-484** — uptime monitoring against `/api/health`. Not configured yet.
- **HON-487** — support email definition (shipped). The `SUPPORT_EMAIL` constant lives in [`src/lib/support.ts`](../../src/lib/support.ts); `/status` and the rest of the surfaces import from there. Triage and SLAs are documented in [`dsr-intake.md`](./dsr-intake.md).
- **HON-482** — breach notification runbook. Status-page copy and the breach email template should share tone and the same support contact.
