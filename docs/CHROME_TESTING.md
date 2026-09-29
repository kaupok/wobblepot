# Browser Testing with Chrome Extension

The [Claude in Chrome extension](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn) enables Claude Code to interact with the browser for dev-time manual testing. This complements Playwright E2E tests by allowing interactive, exploratory testing during development.

## Prerequisites

- Google Chrome browser
- Claude in Chrome extension (v1.0.36+)
- Claude Code CLI (v2.0.73+)

## Enable for a Session

```bash
claude --chrome
```

Or enable mid-session with `/chrome`.

## Use Cases

| Use Case            | Example Prompt                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Test auth flows     | "Go to localhost:3000/sign-in, try signing in with wrong password, verify error message" |
| Form validation     | "Test the sign-up form with invalid inputs and check all validation messages"            |
| Visual verification | "Open the settings page and verify the layout matches expectations"                      |
| Console debugging   | "Open the dashboard and check for any console errors"                                    |
| User flow testing   | "Complete the full sign-up → onboarding → home flow and report any issues"               |
| Record demos        | "Record a GIF showing the household invite flow"                                         |

## Chrome vs Playwright

| Aspect     | Chrome Extension            | Playwright             |
| ---------- | --------------------------- | ---------------------- |
| Purpose    | Dev-time exploration        | Automated regression   |
| Runs in    | Visible browser             | Headless (CI)          |
| Auth state | Uses your logged-in session | Isolated test accounts |
| Best for   | Ad-hoc testing, debugging   | Repeatable test suites |

**Note:** Chrome extension requires a visible browser window and pauses on CAPTCHAs/login pages for manual handling.

## Page map

Regenerated from `find src/app -name page.tsx` on 2026-09-29. Route groups such as `(legal)` are stripped from the paths; `/api/*` route handlers are excluded.

**Access** is derived from each page's server code:

- **Public** — renders without a session.
- **Auth** — calls `auth.api.getSession()` and redirects to `/sign-in` when signed out. Most Auth pages also require a household: without one they redirect to `/onboarding` (and `/onboarding` itself redirects to `/` once you have one).
- **Admin** — requires `isAdmin(session)`, and never redirects to `/sign-in`, so the route does not advertise itself. Signed out, the proxy serves a 404; signed in as a non-admin, you get the not-found page with a 200 status, because the proxy cannot see who is an admin.

To regenerate: re-run the `find`, read each new or changed `page.tsx` far enough to classify it, and update the tables below. The review skills (`/chrome-review`, `/voice-review`, `/ideate`) point here instead of carrying their own copy.

| Route                    | Access        | Purpose                                                                                            |
| ------------------------ | ------------- | -------------------------------------------------------------------------------------------------- |
| `/`                      | Public / Auth | Marketing landing page when signed out; Today dashboard (meals, shopping, catch-up) when signed in |
| `/sign-in`               | Public        | Sign in (redirects to `/` or `/onboarding` if already signed in)                                   |
| `/sign-up`               | Public        | Sign up with a private-beta invite code (redirects to `/` or `/onboarding` if already signed in)   |
| `/forgot-password`       | Public        | Request a password reset email                                                                     |
| `/reset-password`        | Public        | Set a new password from the emailed reset link                                                     |
| `/invite/[code]`         | Auth          | Join a household via invite link (signed out → `/sign-in?returnUrl=…`; unknown code → 404)         |
| `/onboarding`            | Auth          | Create-household form for new accounts (redirects to `/` once a household exists)                  |
| `/recipes`               | Auth          | My recipes — meal library browser                                                                  |
| `/recipes/create`        | Auth          | Create a recipe manually                                                                           |
| `/recipes/imagine`       | Auth          | Imagine a meal — AI recipe generation                                                              |
| `/recipes/import`        | Auth          | Import a recipe from a URL (AI extraction)                                                         |
| `/recipes/[id]/edit`     | Auth          | Edit an existing recipe                                                                            |
| `/shopping`              | Auth          | Shopping list (urgency grouping) on a phone; from `md` up, pantry left and list right              |
| `/pantry`                | Auth          | Pantry inventory on a phone (its own tab); from `md` up, the same two-column page as `/shopping`   |
| `/household`             | Auth          | Household settings, members, and invite links                                                      |
| `/profile`               | Auth          | User profile, your data (export), and account danger zone (delete)                                 |
| `/admin/signup-codes`    | Admin         | Manage private-beta signup codes                                                                   |
| `/status`                | Public        | Service status page — probes database, auth, and AI pipeline                                       |
| `/bot`                   | Public        | About Wobblepot-Bot — crawler user-agent disclosure for site owners                                |
| `/privacy`               | Public        | Privacy policy                                                                                     |
| `/privacy/subprocessors` | Public        | Subprocessor directory (vendor list for the privacy policy)                                        |
| `/terms`                 | Public        | Terms of service                                                                                   |

### Redirect stubs — don't file bugs for these

These routes exist only to keep old links working. Their `page.tsx` bodies are a single `redirect()`; landing on the target is correct behaviour, not a navigation bug.

| Route                | Redirects to | Note                                                       |
| -------------------- | ------------ | ---------------------------------------------------------- |
| `/meal-plan`         | `/`          | The weekly plan now lives on the Today dashboard           |
| `/household/invites` | `/household` | Invites are managed in the Members section of `/household` |

## Reviewing sign-up and onboarding

Sign-up → onboarding → first plan cannot be walked on staging, and that is deliberate (HON-851):

- Staging requires an invite code, and `/api/e2e-seed` — the route that mints one — returns 404 on staging and preview (HON-560).
- A reviewing agent must not create accounts or type passwords on a deployed host. On `localhost`, with test values, it may.
- Onboarding is one-shot: once an account has a household, `/onboarding` redirects to `/`, so a fixture account is used up by the first review.

Review these screens on the **local review server** instead. It runs the checked-out commit with the test-only routes switched on, on its own port:

```bash
pnpm review:local              # branch mode: a throwaway Neon branch forked from staging
pnpm review:local --db env     # env mode: the DATABASE_URL in .env, no branch
```

Start it in the background and wait for the line containing `REVIEW-READY http://localhost:3200`; it is printed once the server answers, so the URL works as soon as you see it. The port is `3200` (`REVIEW_LOCAL_PORT` overrides it), clear of `pnpm dev` on 3000 and `pnpm test:e2e:local` on 3100. Stop it with Ctrl-C or `kill`. It listens on `127.0.0.1` only: the test-only routes are on and rate limiting is off, so it must not be reachable from the network.

| Mode             | Database                                                           | Migrations                                                                                             | When                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| branch (default) | Ephemeral `e2e-local-*` Neon branch, deleted when the server stops | `prisma migrate deploy` on the branch; `--seed` also runs `pnpm db:seed`                               | Normally. It holds one Neon branch while it runs — see `docs/PARALLEL_WORKFLOW.md` → the branch budget                                                                             |
| `--db env`       | `DATABASE_URL` from `.env`                                         | Checked with `prisma migrate status`, never applied — it refuses to start on a database that is behind | When no branch slot is free; the branch-mode cap error names this flag. **Accounts you create persist.** Refuses a `.env` whose `NEXT_PUBLIC_APP_ENV` names a deployed environment |

### Walking the flow

1. Mint an invite code: `curl -X POST http://localhost:3200/api/e2e-seed` → `{"code":"e2e-…"}` (201).
2. Sign up on `/sign-up` with that code, an email of the form `review-<timestamp>@example.com`, and the password `TEST_PASSWORD` from `tests/e2e/utils/test-helpers.ts`. Never a real address or a real password.
3. Sign-up lands on `/onboarding`; complete both steps and `/` shows the first-plan screen.

Each sign-up is a fresh account with no household, so a second sign-up (new code, new email) gives a second fresh onboarding.

### Cleanup

In branch mode, stopping the server deletes the branch and everything on it. In `--db env` mode, remove the review account through the product's own deletion path:

1. Signed in as the review account, delete it on `/profile`.
2. `curl -X POST "http://localhost:3200/api/e2e-support?action=expire-purge&email=<review email>"` — back-dates its purge window.
3. `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3200/api/cron/purge-deleted-users` → `{"purged":1,"scanned":1}`. `$CRON_SECRET` is the value the server started with: `CRON_SECRET` from `.env`, or the fallback literal in `scripts/e2e-local.sh` when `.env` has none.
4. `curl "http://localhost:3200/api/e2e-support?action=user-state&email=<review email>"` → `{"exists":false}`.

**The purge cron purges every account whose deletion window has elapsed, not only the review account.** In `--db env` mode, check before step 3 that nothing else is due — `scanned` should be the number of review accounts you expired:

```sql
SELECT email, "purgeScheduledFor" FROM "user"
WHERE "deletedAt" IS NOT NULL AND "purgeScheduledFor" < now();
```
