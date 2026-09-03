# Deployment Guide

Complete guide for deploying Honkadori to staging and production environments.

## Table of Contents

- [CI Pipeline](#ci-pipeline)
- [Production Deployment Process](#production-deployment-process)
  - [Deployment Flow](#deployment-flow)
  - [Why This Process?](#why-this-process)
  - [Vercel Configuration](#vercel-configuration)
  - [Rollback Procedure](#rollback-procedure)
  - [Security incidents and data breaches](#security-incidents-and-data-breaches)

## CI Pipeline

All changes must pass the following checks in GitHub Actions:

- `pnpm lint` - ESLint rules
- `pnpm format:check` - Prettier
- `pnpm type-check` - TypeScript type checking
- `pnpm test` - Unit tests
- `pnpm test-storybook:ci` - Storybook a11y gate
- `pnpm build-storybook` - Static Storybook build (gate for the GitHub Pages deploy)
- `pnpm test:e2e` - Playwright E2E tier 1 (Docker Postgres sidecar)

**Important notes:**

- Build verification happens through Vercel deployment (not in CI)
- The static Storybook publishes to GitHub Pages (<https://kaupok.github.io/wobblepot/>) from every `main` push that touches a build input — `.github/workflows/deploy-storybook.yml`. It is a docs surface only and sits outside the production release path below
- Locally: `pnpm test:e2e` runs against `pnpm dev`; see [`tests/e2e/README.md`](../tests/e2e/README.md) for details

## E2E testing tiers

See [`tests/e2e/README.md`](../tests/e2e/README.md) for the authoritative tier
definitions. Summary for deployment decisions:

1. **CI E2E** — runs on every push/PR against a Docker Postgres sidecar. Full
   suite. Blocks merge.
2. **Preview-smoke** (`.github/workflows/preview-smoke.yml`) — runs on Vercel
   preview `deployment_status: success` against the real preview URL +
   per-PR Neon branch. Executes `@smoke`-tagged specs. Status check appears
   on the PR.
3. **Staging-smoke** (`.github/workflows/staging-smoke.yml`) — runs after the
   staging DB-migration workflow succeeds on `main`. Executes `@smoke`-tagged
   specs against `https://wobblepot.dev`. **Failure blocks production
   promotion** — do not run the production deploy workflows below until
   staging-smoke is green on the same commit.

## Production Deployment Process

Production deployments require manual coordination to ensure database migrations complete before code deployment.

### Deployment Flow

1. **Develop and merge to main**
   - Create PR with your changes
   - Merge to main after approval and CI passes
   - Staging auto-deploys and auto-migrates (via GitHub Actions)

2. **Test in staging**
   - Verify changes work correctly in staging environment
   - Test all affected functionality
   - Check for any migration issues

3. **Confirm staging-smoke is green**
   - The [staging-smoke workflow](https://github.com/kaupok/wobblepot/actions/workflows/staging-smoke.yml) runs after each staging deploy
   - Do not promote to production until staging-smoke is green on the commit being deployed

4. **Deploy to production** (when ready):

   **a. Run database migrations**
   - Go to: [GitHub Actions](https://github.com/kaupok/wobblepot/actions/workflows/deploy-db-migrations-production.yml)
   - Click "Run workflow" button
   - Wait for completion and verify success

   **b. Deploy code**
   - Go to: [GitHub Actions](https://github.com/kaupok/wobblepot/actions/workflows/deploy-code-production.yml)
   - Click "Run workflow" button
   - Wait for deployment to complete
   - Check workflow summary for deployment URL

   **c. Verify production**
   - Check production site is working
   - Monitor logs for any errors
   - Verify database changes are reflected
   - [GitHub → Environments → Production](https://github.com/kaupok/wobblepot/deployments/Production) shows the deployed commit with a green check

### Why This Process?

Production deployments from main are **disabled via Vercel's Ignored Build Step** to prevent:

- Code deploying before database migrations complete
- Schema mismatches causing runtime errors
- Production downtime from race conditions

The manual process ensures migrations always complete before code deployment.

**Who writes the Production deployment records.** The deploy workflow itself
does — not the Vercel GitHub integration. Vercel reports a build cancelled by
the Ignored Build Step only as a commit status (`Vercel — Canceled by Ignored
Build Step`) and creates no deployment record, and `vercel deploy --prod` is a
CLI deploy the integration never reports at all. So do not expect Vercel's
badges on the Environments → Production page the way you see them on Preview
and staging. Instead, `deploy-code-production.yml` holds `deployments: write`
and posts the record itself: `in_progress` before the deploy, then `success`
(with `environment_url` `https://wobblepot.com`) or `failure` after it. The run
summary links to the record it wrote.

That makes the workflow the only writer **on the release path** — but not the
only way production changes. A Vercel-side promote (the rollback below) moves
production without writing any GitHub record, so the card keeps asserting
whatever the last workflow run said. Correct the record by hand when you roll
back that way; the procedure below says how.

The record steps carry no `continue-on-error` on purpose. A run whose **deploy**
step is green but whose **record** step is red means the release shipped and the
record did not — the drift is meant to be visible rather than swallowed. Left
unwritten, that page goes stale silently: between June and September 2026 its
Active deployment was a failed June build, while production was healthy and many
releases newer (HON-602).

### Vercel Configuration

**Ignored Build Step** is configured with:

```bash
if [ "$VERCEL_ENV" = "production" ]; then exit 0; else exit 1; fi
```

**Vercel Ignored Build Step logic:**

- `exit 0` → "Yes, ignore this build" → Vercel **skips** the build
- `exit 1` → "No, don't ignore this build" → Vercel **proceeds** with build

The command answers "Should I ignore this build?" (not standard shell success/failure logic).

This allows:

- ✅ Preview deployments (PRs) - Auto-deploy
- ✅ Staging environment - Auto-deploy from main
- ❌ Production environment - Manual deploy only

### Email deliverability

Resend + Cloudflare DNS setup, FROM-address conventions, DMARC reading, and
the escalation path (`p=none` → `quarantine` → `reject`, tracked in HON-480)
live in [EMAIL_SETUP.md](./EMAIL_SETUP.md). Confirm `RESEND_API_KEY` is set
in Vercel **production** before promoting any change that touches an email
send-site.

### Rollback Procedure

If production deployment fails:

1. **Code rollback**:
   - Vercel Dashboard → Deployments
   - Find previous working deployment
   - Click "⋯" menu → "Promote to Production"

2. **Correct the GitHub deployment record** — a dashboard promote writes none, so
   Environments → Production would go on showing the rolled-back commit as green
   and Active, which is the same lie the June 2026 badge told (HON-602). Mark the
   bad record inactive, taking `<id>` from the deploy run's summary or from
   `gh api 'repos/kaupok/wobblepot/deployments?environment=Production&per_page=1'`:

   ```bash
   gh api "repos/kaupok/wobblepot/deployments/<id>/statuses" -f state=inactive
   ```

   Then, once `main` carries the fix, re-run **Deploy code [production]** so a
   fresh accurate record is written. Do not stop after the `inactive` — it is not
   sufficient on its own. Don't guess at what the page shows in the meantime
   either: through the June–September 2026 window described above it tracked the
   _newest_ record, surfacing that `failure` while fourteen older deployments sat
   `ACTIVE` behind it. Writing a fresh record is the only reliable way to make
   the page state something true.

3. **Database rollback**: see [RUNBOOKS/database-recovery.md](RUNBOOKS/database-recovery.md) for migration rollback and PITR procedures.

**Prevention**: Always test thoroughly in staging before production deployment.

### Security incidents and data breaches

A failed deploy that **exposes or corrupts personal data** is not just a rollback — it is a potential GDPR personal-data breach with a statutory 72-hour clock. If a deploy leaks a credential, exposes an unauthenticated endpoint, or corrupts user data, follow [RUNBOOKS/breach-notification.md](RUNBOOKS/breach-notification.md) (GDPR Art. 33/34) **in parallel** with the rollback above. The breach clock starts on awareness — do not wait for the rollback to finish before starting the breach process.

### Scheduled jobs (cron)

`vercel.json` defines a daily Vercel Cron at 03:00 UTC that calls `/api/cron/purge-deleted-users` — the GDPR Art. 17 hard-purge of accounts whose 30-day grace window has elapsed. It is authenticated by `CRON_SECRET`, which **must be set on Production** (Vercel auto-injects the `Authorization: Bearer` header on scheduled runs). If `CRON_SECRET` is unset in production the route returns 500 and the purge never runs, breaking the published 30-day retention promise. See [RUNBOOKS/gdpr-deletion.md](RUNBOOKS/gdpr-deletion.md) for the full deletion/recovery flow and the per-model cascade, and [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md) § "Cron secret" for provisioning.
