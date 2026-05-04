# Email Setup

Operator guide for the Wobblepot transactional email pipeline (Resend +
Cloudflare DNS).

## Architecture summary

| Concern                | Choice                                        | Why                                                                     |
| ---------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| Provider               | Resend (free tier)                            | One domain on free tier; Pro ($20/mo) deferred until volume justifies   |
| Sending domain         | `mail.wobblepot.com` (subdomain)              | Keeps apex reputation clean; industry standard (Stripe, Linear, Vercel) |
| Env split              | Single domain across all envs                 | Resend AUP forbids multi-account to dodge limits; Pro tier deferred     |
| Env disambiguation     | `[Staging]` subject prefix outside production | Free, self-evident in inbox; see `envSubject` in `src/lib/resend.ts`    |
| FROM addresses         | Code constants (`EMAIL_SENDERS`)              | Brand-stable, no per-env env vars to drift                              |
| Apex (`wobblepot.com`) | Reserved for `support@` (human reply)         | `noreply@` kills reply loops — avoid                                    |
| `honkadori.xyz`        | Parent legal entity / staging web only        | No outbound email — see HON-539 brand-commit decisions                  |

## FROM-address conventions

Defined as code constants in [`src/lib/resend.ts`](../src/lib/resend.ts) →
`EMAIL_SENDERS`. Apply at every send-site:

| Key             | FROM                                           | Triggers                                                 |
| --------------- | ---------------------------------------------- | -------------------------------------------------------- |
| `auth`          | `Wobblepot <auth@mail.wobblepot.com>`          | Sign-up verification, password reset, magic links        |
| `notifications` | `Wobblepot <notifications@mail.wobblepot.com>` | Meal-plan ready, shopping reminders, future product mail |
| `support`       | `Wobblepot Support <support@wobblepot.com>`    | Human-driven support replies (apex, not subdomain)       |

## Vercel environment variables

Required, **production** environment:

- `RESEND_API_KEY` — get from <https://resend.com/api-keys>. Validated at boot
  via `src/lib/env.ts`; missing key short-circuits sends to a console warning
  rather than throwing, so a forgotten key is silent in production. Verify
  with `vercel env ls production` after rotating.

There is **no** `RESEND_FROM_EMAIL` variable. FROM addresses live in code; if
you need to add a new sender purpose, extend `EMAIL_SENDERS` rather than
reaching for env config.

## DNS records (Cloudflare)

All records on the `wobblepot.com` zone. Resend's Cloudflare auto-configure
flow writes SPF + DKIM directly via OAuth — prefer that over manual entry.

| Record | Host                     | Value                                                                 | Purpose                          |
| ------ | ------------------------ | --------------------------------------------------------------------- | -------------------------------- |
| TXT    | `send.mail`              | `v=spf1 include:amazonses.com ~all`                                   | SPF for Resend's bounce envelope |
| MX     | `send.mail`              | `feedback-smtp.eu-west-1.amazonses.com` (priority 10)                 | Bounce processing                |
| TXT    | `resend._domainkey.mail` | `p=MIGfMA0GCS…` (Resend-provided public key)                          | DKIM signing                     |
| TXT    | `_dmarc`                 | `v=DMARC1; p=none; rua=mailto:dmarc@wobblepot.com; sp=none; pct=100;` | DMARC monitoring                 |

`dmarc@wobblepot.com` is delivered via Cloudflare Email Routing's catch-all,
so aggregate reports land in the routed inbox without extra setup.

### Adding records manually

Cloudflare DNS → `wobblepot.com` → **Add record**. **Always set proxy status
to "DNS only" (grey cloud)** — the orange proxy breaks DKIM CNAMEs. TTL Auto
is fine once verified; use 300 during initial setup if you need fast iteration.

### Verification

```sh
dig @1.1.1.1 +short TXT send.mail.wobblepot.com
dig @1.1.1.1 +short MX send.mail.wobblepot.com
dig @1.1.1.1 +short TXT resend._domainkey.mail.wobblepot.com
dig @1.1.1.1 +short TXT _dmarc.wobblepot.com
```

Resend dashboard flips `mail.wobblepot.com` to **Verified** once SPF + DKIM
propagate (typically minutes).

### Mail-Tester smoke

1. Get a recipient address from <https://www.mail-tester.com>.
2. Trigger a real send from each FROM (forgot-password for `auth@`, etc.).
3. Score should be **≥ 9/10**. Anything lower means a header/content issue —
   debug before promoting.

## DMARC

### Reading aggregate reports

`dmarc@wobblepot.com` receives daily XML reports from major providers (Gmail,
Yahoo, Outlook, etc.). The raw XML is unreadable — pipe through a parser:

- <https://dmarcian.com> — free for low volume, web UI
- <https://postmarkapp.com/dmarc> — free DMARC-monitoring dashboard
- Self-hosted: `parsedmarc` (Python)

What to look for:

- **`disposition`** — should be `none` while we're at `p=none`
- **`spf` / `dkim` alignment** — both should be `pass` for our own sends
- **Unknown source IPs** — investigate if anything outside Resend's range
  appears (could be spoofing or a misconfigured app)

### Escalation path

We start at `p=none` (monitor only). Escalation to `quarantine` then `reject`
is tracked in **HON-480**. Brief order:

1. **`p=none` (current)** — collect aggregate reports for ≥ 14 days. Confirm
   ≥ 99% of legitimate mail passes both SPF and DKIM alignment.
2. **`p=quarantine; pct=10`** — partial enforcement on 10% of mail. Watch
   reports for 7 days for unexpected failures.
3. **`p=quarantine; pct=100`** — full quarantine for ≥ 14 days.
4. **`p=reject`** — full enforcement.

Don't skip steps. Each escalation is a separate Cloudflare DNS edit; the
record TTL is short enough to roll back quickly if reports show breakage.

## Local development

`RESEND_API_KEY` unset → `isEmailConfigured()` returns `false` → send-sites
log the reset URL to console (in `NODE_ENV=development`) and short-circuit.
No actual delivery happens. Sufficient for verifying the flow end-to-end
without a Resend account.

If you do want to test real delivery locally, set `RESEND_API_KEY` in
`.env.local` and `NEXT_PUBLIC_APP_ENV=staging` so subjects get the
`[Staging]` prefix and don't look like prod mail.

## When to revisit this setup

- **Volume crosses 3k emails/month** — Resend free tier limit; upgrading to
  Pro unlocks unlimited domains and removes the "single domain across envs"
  workaround. At that point, register `mail-staging.wobblepot.com` (or use
  `wobblepot.dev` once HON-539 / `.dev` registration ships) for proper
  reputation isolation.
- **Staging incident burns prod sender reputation** — same trigger, sooner.
- **Adding a new sender purpose** — extend `EMAIL_SENDERS`, don't add env
  vars. If the purpose needs a different domain (e.g. marketing on a separate
  subdomain to isolate reputation), that's the same upgrade trigger.

## Related issues

- **HON-465** — this setup (env vars + DNS + docs)
- **HON-480** — DMARC escalation past `p=none`
- **HON-539** — brand commit (sending architecture decisions)
- **HON-538** — brand swap of in-code `honkadori.xyz` references
- **HON-487** — support email surface and DSR triage
