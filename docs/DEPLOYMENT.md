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
  - [Scheduled jobs (cron)](#scheduled-jobs-cron)
  - [Global meal illustrations](#global-meal-illustrations)

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

1. **CI E2E** — runs on every push/PR against a Docker Postgres sidecar. Every
   spec **except `@ai`** (`ci.yml` runs `--grep-invert=@ai`). Blocks merge.
2. **Preview-smoke** (`.github/workflows/preview-smoke.yml`) — runs on Vercel
   preview `deployment_status: success` against the real preview URL +
   per-PR Neon branch. Executes `@smoke`-tagged specs. Status check appears
   on the PR.
3. **Staging-smoke** (`.github/workflows/staging-smoke.yml`) — runs after the
   staging DB-migration workflow succeeds on `main`. Executes `@smoke`-tagged
   specs against `https://wobblepot.dev`. **Failure blocks production
   promotion** — do not run the production deploy workflows below until
   staging-smoke is green on the same commit.

The `@ai` specs are in no tier: they call Claude for real, so they run as a
**manual pre-promotion step** (`pnpm test:e2e:local --ai`, step 3 below), not
on a schedule and not against a mock. That step is meal-plan generation's only
coverage.

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

3. **Confirm the pre-promotion test gates**
   - The [staging-smoke workflow](https://github.com/kaupok/wobblepot/actions/workflows/staging-smoke.yml) runs after each staging deploy
   - Do not promote to production until staging-smoke is green on the commit being deployed
   - **Run the `@ai` specs by hand on the commit being promoted:** `pnpm test:e2e:local --ai`. No CI tier runs them — they call Claude for real, and per-push runs would cost four to five figures a year (see [`tests/e2e/README.md`](../tests/e2e/README.md) → "Why the `@ai` split"). They are meal-plan generation's **only** coverage, so skipping this step promotes the core AI flow untested (HON-667)

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

After the `success` status, the same run **retires the previous release's
record** — it marks every other `ACTIVE` Production deployment `inactive`, so
the page lists exactly one active release at a time (HON-611). That sweep is
explicit because the `auto_inactive` flag on the status is observably a no-op
here; without it, 14 records claiming to be active had piled up by
September 2026. `FAILURE` records are left alone — they are honest history of
a failed deploy, not stale actives.

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

   The re-run also retires whatever is still `ACTIVE`, including the bad record
   (HON-611), so there is nothing older to chase afterwards. Still post the
   `inactive` above straight away: it is what stops the page asserting the
   rolled-back commit is live during the window between the promote and the
   re-run.

3. **Database rollback**: see [RUNBOOKS/database-recovery.md](RUNBOOKS/database-recovery.md) for migration rollback and PITR procedures.

**Prevention**: Always test thoroughly in staging before production deployment.

### Security incidents and data breaches

A failed deploy that **exposes or corrupts personal data** is not just a rollback — it is a potential GDPR personal-data breach with a statutory 72-hour clock. If a deploy leaks a credential, exposes an unauthenticated endpoint, or corrupts user data, follow [RUNBOOKS/breach-notification.md](RUNBOOKS/breach-notification.md) (GDPR Art. 33/34) **in parallel** with the rollback above. The breach clock starts on awareness — do not wait for the rollback to finish before starting the breach process.

### Scheduled jobs (cron)

`vercel.json` defines a daily Vercel Cron at 03:00 UTC that calls `/api/cron/purge-deleted-users` — the GDPR Art. 17 hard-purge of accounts whose 30-day grace window has elapsed. It is authenticated by `CRON_SECRET`, which **must be set on Production** (Vercel auto-injects the `Authorization: Bearer` header on scheduled runs). If `CRON_SECRET` is unset in production the route returns 500 and the purge never runs, breaking the published 30-day retention promise. See [RUNBOOKS/gdpr-deletion.md](RUNBOOKS/gdpr-deletion.md) for the full deletion/recovery flow and the per-model cascade, and [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md) § "Cron secret" for provisioning.

### Global meal illustrations

Global meals (`householdId` null — the seed catalogue every household sees) never get an image from the lazy route `POST /api/meals/[id]/image`: one household's AI cap must not pay for a shared asset (HON-735). An operator draws them once with `scripts/generate-global-meal-images.ts` (HON-738).

**When to run it:** after new global seed meals land, after a global meal's name, description, ingredients or preparation notes change (the edit clears its image), and after a bump of `MEAL_IMAGE_PROMPT_VERSION` in `src/lib/meal-images/prompt.ts`, which makes every existing image stale. It selects global meals whose `imageStatus` is not `ready`, or whose `imagePromptVersion` is not the current one, so a rerun only picks up what is missing.

**Cost:** about $0.042 per image, plus about $0.008 per image with `--judge`, so ~$11.50 for the full ~273-meal catalogue. It is printed at the end and never ledgered: no household owns it, so there are no `AiUsage` rows.

**1. Dry run (free).** Prints the number of meals and the estimated cost. It only reads the database.

```bash
pnpm meal-images:global                       # all meals that need an image
pnpm meal-images:global --meal="Irish Lamb Stew"   # one meal, by id or English name
```

**2. Generate (costs money, needs `OPENAI_API_KEY`).** Draws into `.temp/global-meal-images/<timestamp>/`: one image per meal (`<slug>.png`), a `manifest.json` and a contact sheet, `index.html`. It writes nothing to the database or to Blob, so it is safe against any `DATABASE_URL` — which is only read to select the meals. Start with a small slice.

```bash
pnpm meal-images:global --confirm --limit=3
pnpm meal-images:global --confirm [--judge] [--concurrency=4]
```

`--judge` adds the `REVIEW_MODEL` vision check in report-only mode: its findings show on each contact-sheet cell but never trigger a regeneration. Here the operator is the gate, so it is optional.

**3. Review.** Open `index.html` and note the slug of every image to reject. The images are drawn from the English name and description and shared by every locale.

**4. Publish to staging, then to production.** Point the environment at the target — its `DATABASE_URL`, plus Blob credentials for the **same** environment, since staging and production use different Blob stores (see [ENVIRONMENT_SETUP.md § Vercel Blob](ENVIRONMENT_SETUP.md#vercel-blob-meal-images)). Blob authenticates with `BLOB_STORE_ID` plus `VERCEL_OIDC_TOKEN`, and the token expires after about a day. The script checks it before uploading and prints the refresh steps; `vercel env pull --environment=<env> /tmp/<file>` gives you a fresh one (never a bare `vercel env pull`, which writes `.env.local`). A static `BLOB_READ_WRITE_TOKEN` for the store also works.

```bash
pnpm meal-images:global --publish=.temp/global-meal-images/<timestamp> --exclude=slug-one,slug-two
```

It prints what it will skip and why, then the database host and Blob store, and publishes only after you type the host back exactly (`--yes=<host>` does the same non-interactively). For each image it uploads through `putMealImage` and sets `imageUrl`, `imageStatus = ready` and `imagePromptVersion`, and it deletes the blob of an older-version image it replaces.

Because generation does not depend on the environment, publish the **same run directory** to staging, check it on `wobblepot.dev`, then publish it to production. Meals are matched by the slug of their English name (ids differ between databases). A meal is skipped if it is already `ready` at the current version, so publishing twice is a no-op. It is also skipped if its prompt no longer matches the one drawn, meaning the meal changed since: regenerate it. Publish uses the route's claim columns (`imageClaimedAt`), so two concurrent publishes cannot both attach an image, and an edit mid-upload discards the upload.

**5. Rejected meals.** An excluded meal stays without an image and is selected again by the next `--confirm` run. Repeat steps 2–4 for just those, with `--meal=` or a fresh full run.
