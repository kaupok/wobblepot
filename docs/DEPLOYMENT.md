# Deployment Guide

Complete guide for deploying Wobblepot to staging and production environments.

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
  - [Meal hue backfill](#meal-hue-backfill)
  - [Meal footprint backfill](#meal-footprint-backfill)
  - [Library preparation steps](#library-preparation-steps)

## CI Pipeline

Every PR and every push to `main` runs the following checks in GitHub Actions (`.github/workflows/ci.yml`, in this order). Docs-only changes (`**/*.md`, `docs/**`) skip CI entirely:

- `scripts/check-migrations-immutable.sh` - Applied migrations are unchanged (the PR diff, and the whole tree on `main`)
- `pnpm lint` - ESLint rules
- `pnpm format:check` - Prettier
- `pnpm type-check` - TypeScript type checking
- `pnpm lockfile:check` - Pinned dependency resolutions (HON-595)
- `pnpm stories:check` - Every component has a colocated story
- `pnpm test` - Unit tests
- `pnpm db:validate` - Seed data
- `scripts/check-smoke-specs.sh` - `@smoke` specs are staging-safe
- `pnpm test-storybook:ci` - Storybook a11y gate
- `pnpm build-storybook` - Static Storybook build (gate for the GitHub Pages deploy)
- `pnpm test:e2e --grep-invert=@ai` - Playwright E2E tier 1 (Docker Postgres sidecar)
- `pnpm audit --audit-level critical` - Dependency advisories
- `pnpm env:audit --strict` - Vercel env-var drift, as a separate job (see [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md) → "Drift audit")

**Important notes:**

- **None of these is a required status check yet.** `main` has no required checks, so a red check shows on the PR but does not stop a merge; it is on whoever merges to read it. HON-584 tracks making them required.
- CI builds the app as part of the E2E step (Playwright starts `pnpm build && pnpm start`). Vercel builds each deployment separately
- The static Storybook publishes to GitHub Pages (<https://kaupok.github.io/wobblepot/>) from every `main` push that touches a build input — `.github/workflows/deploy-storybook.yml`. It is a docs surface only and sits outside the production release path below
- Locally: `pnpm test:e2e` runs against `pnpm dev`; see [`tests/e2e/README.md`](../tests/e2e/README.md) for details

## E2E testing tiers

See [`tests/e2e/README.md`](../tests/e2e/README.md) for the authoritative tier
definitions. Summary for deployment decisions:

1. **CI E2E** — runs on every push/PR against a Docker Postgres sidecar. Every
   spec **except `@ai`** (`ci.yml` runs `--grep-invert=@ai`). A failure turns
   the PR check red; it does not block the merge until HON-584 makes the check
   required.
2. **Preview-smoke** (`.github/workflows/preview-smoke.yml`) — runs on Vercel
   preview `deployment_status: success` against the real preview URL +
   per-PR Neon branch, **only when the PR carries the `smoke` label**.
   Executes `@smoke`-tagged specs. Status check appears on the PR.
3. **Staging-smoke** (`.github/workflows/staging-smoke.yml`) — runs after the
   staging DB-migration workflow succeeds on `main`, every six hours on a
   schedule, and on manual dispatch. Executes `@smoke`-tagged
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
   - The same run then executes `pnpm db:seed` against production. It creates any seeded ingredient or meal that is missing and re-asserts every seeded translation, but it does not rewrite existing rows: an existing ingredient only has `gramsPerPiece` refreshed, and an existing meal's name and components are never updated. Renaming a seeded row therefore needs a migration (see [`RUNBOOKS/translation-maintenance.md`](./RUNBOOKS/translation-maintenance.md) → "The seed re-asserts translations" and "Renaming a seeded ingredient or meal")
   - Nothing runs this step for you: step 4b does not depend on it, so skipping it ships code against an unmigrated, unseeded database

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

A failed record write never goes green. The step that creates the record does
carry `continue-on-error`, so that a deployments-API failure cannot cancel a
release whose migrations are already applied, and the job's final step turns
that failure back into a red run; the status steps carry none. A run whose **deploy**
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

**Cost:** about $0.06 per image ($0.042 for the drawing and $0.018 for the three vessel samples that set its footprint, see [Meal footprint backfill](#meal-footprint-backfill)), plus about $0.008 per image with `--judge`, so ~$16.50 for the full ~273-meal catalogue. It is printed at the end and never ledgered: no household owns it, so there are no `AiUsage` rows.

**1. Dry run (free).** Prints the number of meals and the estimated cost. It only reads the database.

```bash
pnpm meal-images:global                       # all meals that need an image
pnpm meal-images:global --meal="Irish Lamb Stew"   # one meal, by id or English name
pnpm meal-images:global --type=breakfast           # only meals suitable for one slot
```

**2. Generate (costs money, needs `OPENAI_API_KEY`).** Draws into `.temp/global-meal-images/<timestamp>/`: one image per meal (`<slug>.png`), a `manifest.json` and a contact sheet, `index.html`. It writes nothing to the database or to Blob, so it is safe against any `DATABASE_URL` — which is only read to select the meals. Start with a small slice.

```bash
pnpm meal-images:global --confirm --limit=3
pnpm meal-images:global --confirm [--judge]
```

**Rate limit — plan on about an hour for the full catalogue.** The OpenAI organisation's tier allows **5 images per minute** for `gpt-image-2.5-flare`, so ~273 meals take at least ~55 minutes however the run is split; at one image in flight (~18 s each) expect nearer 80. `--concurrency` therefore defaults to 1: the first real run, at `--concurrency=4`, lost 4 of 16 images to 429s (HON-742). A rate-limited image is retried after the delay OpenAI names, or 15 s, 30 s and 60 s, before its meal is marked failed; a failed meal is simply selected again by the next `--confirm`. The run ends by printing its effective rate in images per minute — at or near 5, the tier is the bottleneck and more lanes would only add waiting. `pnpm meal-images:global --help` lists every flag.

`--judge` adds the `REVIEW_MODEL` vision check in report-only mode: its findings show on each contact-sheet cell but never trigger a regeneration. Here the operator is the gate, so it is optional.

**3. Review.** Open `index.html` and note the slug of every image to reject. The images are drawn from the English name and description and shared by every locale. Each file is already fitted: `generateMealImage` classifies the vessel and scales every vessel to its size, a 27 cm plate at 0.58 of the frame width, before the batch writes it (HON-1024), so the sheet shows what will be published. The manifest records the `vessel` and the `fit` per image.

**4. Publish to staging, then to production.** Point the environment at the target — its `DATABASE_URL`, plus Blob credentials for the **same** environment, since staging and production use different Blob stores (see [ENVIRONMENT_SETUP.md § Vercel Blob](ENVIRONMENT_SETUP.md#vercel-blob-meal-images)). The script checks the credentials before uploading and prints these steps when they are missing or expired.

- **Staging** authenticates with `BLOB_STORE_ID` plus `VERCEL_OIDC_TOKEN`. The token expires after about a day; `vercel env pull --environment=<env> /tmp/<file>` gives you a fresh one (never a bare `vercel env pull`, which writes `.env.local`).
- **Production refuses a pulled OIDC token.** A token from `vercel env pull` carries the claim `environment: development`, whatever `--environment` names, and the production store is connected to Production only, so every upload fails with `OIDC is enabled for this project, but not for the "development" environment` (HON-1050). Use the store's static read-write token instead:
  1. In the Vercel dashboard, open the production Blob store (`wobblepot-images-prod`) → Projects → **Configure honkadori**. Tick **Add a read-write token env var to this connection**, with **Sensitive off**. Vercel writes `BLOB_READ_WRITE_TOKEN` into Production. A sensitive variable can never be read back, so with Sensitive on the pull below returns an empty value. The deployed app is unaffected, because `@vercel/blob` prefers OIDC when both are set. Do this once.
  2. Export the token in the shell, and blank both the OIDC token and the store id. The scripts load `.env` through `dotenv/config`, which fills in any variable that is not already set, so `unset VERCEL_OIDC_TOKEN` brings the stale `.env` token back and the script reports it as expired. An empty value counts as absent. The store id must be blank too: with no OIDC token, `@vercel/blob` tries to refresh one from the linked Vercel project, and if that works, a set `BLOB_STORE_ID` wins over the read-write token and the upload goes to the staging store from `.env`. The script refuses that combination. The read-write token carries its own store id:

```bash
vercel env pull --environment=production /tmp/wobblepot-prod.env
export BLOB_READ_WRITE_TOKEN="$(grep '^BLOB_READ_WRITE_TOKEN=' /tmp/wobblepot-prod.env | cut -d= -f2- | tr -d '"')"
export VERCEL_OIDC_TOKEN=   # empty, not unset: dotenv would refill it from .env
export BLOB_STORE_ID=       # empty too, so a refreshed OIDC token cannot pick the staging store
rm /tmp/wobblepot-prod.env
```

On this path the script names `BLOB_READ_WRITE_TOKEN` as its Blob source before it asks for the host. Then publish:

```bash
pnpm meal-images:global --publish=.temp/global-meal-images/<timestamp> --exclude=slug-one,slug-two
```

It prints what it will skip and why, then the database host and Blob store, and publishes only after you type the host back exactly (`--yes=<host>` does the same non-interactively). For each image it uploads through `putMealImage` and sets `imageUrl`, `imageStatus = ready` and `imagePromptVersion`, and it deletes the blob of an older-version image it replaces.

Because generation does not depend on the environment, publish the **same run directory** to staging, check it on `wobblepot.dev`, then publish it to production. Meals are matched by the slug of their English name (ids differ between databases). A meal is skipped if it is already `ready` at the current version, so publishing twice is a no-op. It is also skipped if its prompt no longer matches the one drawn, meaning the meal changed since: regenerate it. Publish uses the route's claim columns (`imageClaimedAt`), so two concurrent publishes cannot both attach an image, and an edit mid-upload discards the upload.

**5. Rejected meals.** An excluded meal stays without an image and is selected again by the next `--confirm` run. Repeat steps 2–4 for just those, with `--meal=` or a fresh full run.

### Meal hue backfill

A meal's card tint comes from `Meal.imageHue`, which is extracted from its image once, when the image is stored ([DESIGN.md → Imagery](DESIGN.md#imagery)). When the rule in `src/lib/meal-images/colour.ts` changes (HON-1009 made it pick the most distinctive colour against `HUE_BASELINE`), stored meals keep their old hue until `scripts/backfill-meal-hues.ts` re-extracts it. It fetches each stored image and regenerates nothing, so it costs no AI spend. It reads every meal with `imageStatus = ready` and an `imageUrl`; a household's copy of a global meal shares that meal's image, so each distinct image is fetched once. An image that cannot be fetched is logged and its meals are skipped.

**When to run it:** after a change to the hue rule or to `HUE_BASELINE`, on staging and then production. Meals drawn after the change already get the new rule.

**1. Dry run (writes nothing).** Writes a contact sheet to `.temp/meal-hues/<timestamp>/index.html` (each meal's image on a card in its old tint and its new tint, with both hues) and prints a 20° histogram of the old and new hues.

```bash
pnpm meal-images:rehue
```

**2. Review.** Open the sheet. A tint should come from the food: a green dish green, a tomato dish red, a brown stew still orange.

**3. Write, on staging and then production.** Point `DATABASE_URL` at the target and confirm. It asks for the database host to be typed back (`--yes=<host>` does the same non-interactively) and then writes `imageHue` for each meal whose hue changed. Nothing else changes: `updatedAt` is pinned, as in the image route, and a meal whose image or content changed since it was read is skipped and picked up by a rerun.

```bash
pnpm meal-images:rehue --confirm
```

**Regenerating `HUE_BASELINE`.** `pnpm meal-images:rehue --baseline` prints the mean hue-bin shares over the distinct stored images as a ready-to-paste `HUE_BASELINE`, and writes nothing. The constant is checked in, so a new one lands in a PR (update the date and source in its comment) before the backfill runs. Regenerate it when the image style changes, such as a `MEAL_IMAGE_PROMPT_VERSION` bump or HON-971. The 2026-10-03 constant came from the 25 distinct images in a fork of staging; one taken from the full production catalogue is more representative.

**The landing page is not in the database.** `src/components/landing/LandingShowcase.tsx` hardcodes the hues of the three illustrations in `public/landing/`, so the backfill does not reach them. After a rule or baseline change, re-extract them with `extractHue` and update the three values in the same PR.

`pnpm meal-images:rehue --help` lists every flag.

### Meal footprint backfill

Every vessel in a meal illustration is drawn to one scale: a 27 cm dinner plate is 0.58 of the frame width and a smaller vessel narrower by its diameter, with the drawing centred top to bottom ([DESIGN.md → Imagery](DESIGN.md#imagery)). `generateMealImage` fits each image it keeps: a `REVIEW_MODEL` vision call names the vessel and estimates its diameter from the food on it, and `src/lib/meal-images/footprint.ts` scales the drawing about the rim and pads it with white (HON-1024). Images stored before that, or before a change to `FOOTPRINT_SCALE`, keep the width they were drawn at until `scripts/refit-meal-images.ts` refits them from the stored file. Nothing is regenerated. It reads every meal with `imageStatus = ready` and an `imageUrl`, fetches each distinct image once (a household's copy of a global meal shares its image), and leaves an image it cannot read or classify as it is. The fit reads the vessel and diameter stored on the meal (`imageVessel`, `imageDiameterCm`), which the image route and the global publish write when they store an image (HON-1034). Only an image without a stored estimate is classified, the only AI spend at about $0.018 per image (it needs `ANTHROPIC_API_KEY`), and `--confirm` stores that estimate, also on an image that does not move. So a refit moves each image by the rule change alone, and a rerun asks the model nothing. The summary's last line counts the images that used a stored estimate and those classified in the run. The first refit after HON-1034 classifies every image stored before it, and those estimates carry the sampling churn below once. The model is shown every image with its rim at one width, so the answer does not depend on what the last fit did, and it is asked three times and settled on the median, because one answer moved by 2 cm between runs on a fifth of the images. Between two reruns on 51 images the median moved on 6, four of them by 1 cm, which is inside the fit's tolerance; a 2 cm move refits the image by a few percent.

**When to run it:** after a change to the scale or to the measurement, on staging and then production. Meals drawn after the change are already fitted. Running it twice is a no-op: a fitted image measures at its target and is kept. A change to `VESSEL_PROMPT` in `src/lib/meal-images/vessel.ts` is not picked up from stored estimates: the refit classifies only an image whose meals have none.

**1. Dry run (writes nothing).** Writes the fitted files and a contact sheet to `.temp/meal-footprints/<timestamp>/index.html`: each image as drawn and as fitted, under dashed guides at the width its size calls for and the frame's centre line, with the vessel and its diameter on each card, plus a per-vessel summary of the sizes, how many images move and the range of camera elevations the plates were drawn at.

```bash
pnpm meal-images:refit
```

**2. Review.** Open the sheet. Every vessel fills its guides with the drawing centred on the horizontal line, and a side plate's guides are narrower than a dinner plate's. Check the diameter on a card that looks wrong for its food: a bagel sits on a 20 to 24 cm plate, a shakshuka on 26 to 27. The camera elevation on each plate's card is reported, not corrected: a plate far from the others (most sit between 35° and 44°) can only be redrawn.

**3. Write, on staging and then production.** Point the environment at the target: its `DATABASE_URL`, plus Blob credentials for the **same** environment, exactly as for a publish (above). It checks the Blob credentials, asks for the database host to be typed back (`--yes=<host>` does the same non-interactively), then for each rescaled image uploads the fitted file through `putMealImage` to a new URL, moves `imageUrl` for every meal on the old URL with `updatedAt` pinned, and deletes the old blob once every meal on it has moved. An estimate classified in the run is written in the same update, or on its own, under the same pins, for an image that stays. `imageHue` does not change: the hue rule drops white and grey pixels, so scale does not affect it. A meal whose image or content changed since it was read is skipped and picked up by a rerun.

```bash
pnpm meal-images:refit --confirm
```

**The landing page is not in the database.** The three illustrations in `public/landing/` were fitted by hand in HON-1024 (`fitFootprint`, then JPEG at quality 92) and moved to the box-centre anchor in HON-1031 (`fitFootprint` with the diameter whose target is the rim's current width, so the scale is 1). After a target or anchor change, refit them the same way in the PR, and re-extract their hues for `LandingShowcase.tsx`: a move changes what the centre crop sees.

`pnpm meal-images:refit --help` lists every flag.

### Library preparation steps

The signed-out home page shows three library meals a day and opens each in the cook view, steps included (`src/lib/landing/load-demo-day.ts`, `LandingDemo`). A public page must never call the AI, so an operator writes the steps ahead of time with `scripts/generate-library-steps.ts` into `MealPreparationSteps`: one row per meal and locale, for the meal's own `servings`. The page picks only from library meals that have a ready illustration and a fresh row; when it cannot fill breakfast, lunch and dinner it falls back to a static example day, so the script is never a blocker, only the switch that turns the demo on.

**It runs on every deploy.** Both migration workflows (`deploy-db-migrations-staging.yml`, `deploy-db-migrations-production.yml`) run `pnpm steps:library --confirm --limit=30` after the seed, with `continue-on-error` and an 8-minute step timeout, so a provider outage never blocks a deploy and a partial run only leaves some meals out of the demo until the next one. The step uses the `ANTHROPIC_API_KEY_CI` repository secret, the same key `ci.yml` runs the AI tests with (the older `ANTHROPIC_API_KEY` secret is stale and rejected). A rerun writes only what is missing or stale: a meal that got an illustration since, or one whose name, servings, time, ingredients or translation changed (the row's `inputHash` no longer matches `stepsInputHash` of the prompt inputs), or a new locale. The seed's unconditional meal update does not stale anything, because the hash reads the meal's content, not its `updatedAt`. Most deploys write nothing. The rows are per database, so staging and production fill independently. Run it by hand only to fill a database ahead of a deploy, or past the per-run cap.

**Cost:** about $0.02 per meal and locale on Sonnet, so ~$0.70 for the 16-meal pool in both locales. Printed at the end and never ledgered: no household owns it.

```bash
pnpm steps:library                           # dry run: what would be written, and the estimate
pnpm steps:library --confirm                 # write every missing or stale row (needs ANTHROPIC_API_KEY)
pnpm steps:library --locale=et --limit=5     # one locale, first five
pnpm steps:library --meal="Beef Bibimbap" --confirm
```
