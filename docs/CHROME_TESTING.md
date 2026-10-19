# Browser review

The reference for reviewing the app in a real browser, by hand or with an agent. It complements the Playwright E2E suite with interactive, exploratory testing. `/chrome-review`, `/ideate` and `/implement-issue` → Drive changed screens read it. An agent has three browsers:

- **T3 Code sidebar browser:** the `mcp__t3-code__preview_*` tools. The first choice, because the user sees the tab the agent drives.
- **Claude in Chrome extension:** the `mcp__claude-in-chrome__*` tools, in your own Chrome window.
- **Playwright MCP:** the `mcp__playwright__browser_*` tools, headless. A `wt auto` worker has only this one.

It contains:

- **Browsers:** [which browser to use](#which-browser), [the T3 Code sidebar browser](#t3-code-sidebar-browser), [the tool mapping](#tool-mapping), [how the three compare](#comparison), [the Chrome extension](#chrome-extension), and [use cases](#use-cases).
- **[Page map](#page-map):** every page route, who can reach it, and the redirect stubs that are not bugs.
- **[Reviewing sign-up and onboarding](#reviewing-sign-up-and-onboarding):** why that flow is walked on a local review server (`pnpm review:local`) rather than staging, how to walk it, and how to clean up.

## Which browser

Check the tools listed in the session, in this order:

1. If `mcp__t3-code__preview_*` tools are listed, use them. The tab is bound to the thread and the user sees it in the sidebar.
2. Else if `mcp__claude-in-chrome__*` tools are listed, use them.
3. Else if the Playwright MCP (`mcp__playwright__browser_*`) is loaded, use it.
4. Else say so and continue without browsing. `/chrome-review` stops, because it has no other purpose. `/implement-issue` writes a "Not verified" line.

`/implement-issue` → Drive changed screens skips the Chrome extension (step 2), because it uploads a screenshot file and the Chrome extension cannot save one.

Why this order: the sidebar browser shows the user the same page the agent sees, so the agent does not need to narrate screenshots. The Chrome extension needs a Chrome window and the `--chrome` harness. The Playwright MCP is headless, so the user sees nothing, but it is the only browser a headless worker has (`docs/PARALLEL_WORKFLOW.md` → Untracked Files).

## T3 Code sidebar browser

Every T3 Code session has a browser in its sidebar. The agent drives it with the `preview_*` tools, and the user watches the same tab live.

- **Open a tab:** `preview_open` with the URL, for example `https://wobblepot.dev/`. It returns `tabId`, `url`, `visible` and the list of browser profiles.
- **Go to the local server:** `preview_navigate` with `{kind: 'environment-port', port: 3200}` for `pnpm review:local`, or `port: 3000` for `pnpm dev`. Use the port that the `REVIEW-READY` line names, because `REVIEW_LOCAL_PORT` can move it. It also takes a plain `url`.
- **See what is open:** `preview_status`.
- **Inspect:** `preview_snapshot` returns an accessibility tree with `aria-ref` locators. `preview_click` and `preview_type` take those locators.
- **Screenshot to disk:** `preview_snapshot` with `save: true` writes a PNG under `~/.t3/userdata/browser-artifacts/` and returns its `screenshotPath`.
- **Close:** `t3_preview_close`.

The user sees the tab, so describe what matters and do not paste every screenshot into the chat.

## Tool mapping

The same step in the two tool sets that `/implement-issue` uses. The Chrome extension is not in the table: its tools are listed in a `--chrome` session, and `tabs_context_mcp` shows what is open.

| Action             | T3 Code sidebar                      | Playwright MCP            |
| ------------------ | ------------------------------------ | ------------------------- |
| See what is open   | `preview_status`                     | `browser_tabs`            |
| Open a URL         | `preview_open` / `preview_navigate`  | `browser_navigate`        |
| Read the page      | `preview_snapshot`                   | `browser_snapshot`        |
| Click              | `preview_click`                      | `browser_click`           |
| Type               | `preview_type`                       | `browser_type`            |
| Press a key        | `preview_press`                      | `browser_press_key`       |
| Wait               | `preview_wait_for`                   | `browser_wait_for`        |
| Screenshot to disk | `preview_snapshot` with `save: true` | `browser_take_screenshot` |
| Close              | `t3_preview_close`                   | `browser_close`           |

## Comparison

| Aspect      | T3 Code sidebar                      | Chrome extension         | Playwright MCP                       |
| ----------- | ------------------------------------ | ------------------------ | ------------------------------------ |
| Purpose     | Review with the user watching        | Dev-time exploration     | Driving screens with nobody watching |
| Runs in     | The T3 Code sidebar                  | Your Chrome window       | A headless browser                   |
| Who sees it | The user and the agent, live         | The user and the agent   | The agent only                       |
| Auth state  | The sidebar profile's cookies        | Your logged-in session   | A fresh session per run              |
| Best for    | `/ideate`, `/chrome-review`, driving | Sessions outside T3 Code | `wt auto` workers, headless runs     |

The Playwright E2E suite (`pnpm test:e2e`) is a separate thing: automated regression with isolated test accounts. See `tests/e2e/README.md`.

## Chrome extension

The fallback outside T3 Code: the [Claude in Chrome extension](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn). It needs a visible Chrome window and pauses on CAPTCHAs and login pages for you to handle.

### Prerequisites

- Google Chrome browser
- Claude in Chrome extension (v1.0.36+)
- Claude Code CLI (v2.0.73+)

### Enable for a session

```bash
claude --chrome
```

Or enable mid-session with `/chrome`.

## Use Cases

These prompts work with any of the three browsers.

| Use Case            | Example Prompt                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Test auth flows     | "Go to localhost:3000/sign-in, try signing in with wrong password, verify error message" |
| Form validation     | "Test the sign-up form with invalid inputs and check all validation messages"            |
| Visual verification | "Open the settings page and verify the layout matches expectations"                      |
| Console debugging   | "Open the dashboard and check for any console errors"                                    |
| User flow testing   | "Complete the full sign-up → onboarding → home flow and report any issues"               |
| Record demos        | "Record a GIF showing the household invite flow" (Chrome extension only)                 |

## Page map

Regenerated from `find src/app -name page.tsx` on 2026-09-29. Route groups such as `(legal)` are stripped from the paths; `/api/*` route handlers are excluded.

**Access** is derived from each page's server code:

- **Public** — renders without a session.
- **Auth** — calls `auth.api.getSession()` and redirects to `/sign-in` when signed out. Most Auth pages also require a household: without one they redirect to `/onboarding` (and `/onboarding` itself redirects to `/` once you have one).
- **Admin** — requires `isAdmin(session)`, and never redirects to `/sign-in`, so the route does not advertise itself. Signed out, the proxy serves a 404; signed in as a non-admin, you get the not-found page with a 200 status, because the proxy cannot see who is an admin.

To regenerate: re-run the `find`, read each new or changed `page.tsx` far enough to classify it, and update the tables below. The review skills (`/chrome-review`, `/ideate`) point here instead of carrying their own copy.

| Route                         | Access        | Purpose                                                                                            |
| ----------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `/`                           | Public / Auth | Marketing landing page when signed out; Today dashboard (meals, shopping, catch-up) when signed in |
| `/sign-in`                    | Public        | Sign in (redirects to `/` or `/onboarding` if already signed in)                                   |
| `/sign-up`                    | Public        | Sign up with a private-beta invite code (redirects to `/` or `/onboarding` if already signed in)   |
| `/forgot-password`            | Public        | Request a password reset email                                                                     |
| `/reset-password`             | Public        | Set a new password from the emailed reset link                                                     |
| `/invite/[code]`              | Public        | Join a household via invite link (signed out → Create account or Sign in; unknown code → 404)      |
| `/past-meals`                 | Auth          | The past 7 days, newest first, to mark meals cooked or skipped; linked from Today's notice         |
| `/onboarding`                 | Auth          | Create-household form for new accounts (redirects to `/` once a household exists)                  |
| `/recipes`                    | Auth          | My recipes — meal library browser                                                                  |
| `/recipes/create`             | Auth          | Create a recipe manually                                                                           |
| `/recipes/imagine`            | Auth          | Imagine a meal — AI recipe generation                                                              |
| `/recipes/import`             | Auth          | Import a recipe from a URL (AI extraction)                                                         |
| `/recipes/[id]/edit`          | Auth          | Edit an existing recipe                                                                            |
| `/shopping`                   | Auth          | Shopping list (urgency grouping) on a phone; from `md` up, pantry left and list right              |
| `/pantry`                     | Auth          | Pantry inventory on a phone (its own tab); from `md` up, the same two-column page as `/shopping`   |
| `/household`                  | Auth          | Household → Members: the member list and per-member invite links                                   |
| `/household/meal-preferences` | Auth          | Household → Meal preferences: food preferences, meals to plan                                      |
| `/household/settings`         | Auth          | Household → Settings: name, timezone, language, then Leave household                               |
| `/account`                    | Auth          | My account → Profile: name, email and its verification, password                                   |
| `/account/reminders`          | Auth          | My account → Reminders: the viewer's own weekly planning reminder email                            |
| `/account/connections`        | Auth          | My account → Connections: AI assistants, read-only API keys                                        |
| `/account/data`               | Auth          | My account → Your data: export, and account danger zone (delete)                                   |
| `/admin/signup-codes`         | Admin         | Manage private-beta signup codes                                                                   |
| `/status`                     | Public        | Service status page — probes database, auth, and AI pipeline                                       |
| `/bot`                        | Public        | About Wobblepot-Bot — crawler user-agent disclosure for site owners                                |
| `/privacy`                    | Public        | Privacy policy                                                                                     |
| `/privacy/subprocessors`      | Public        | Subprocessor directory (vendor list for the privacy policy)                                        |
| `/terms`                      | Public        | Terms of service                                                                                   |

### Redirect stubs — don't file bugs for these

These routes exist only to keep old links working. Their `page.tsx` bodies are a single `redirect()`; landing on the target is correct behaviour, not a navigation bug.

| Route        | Redirects to | Note                                             |
| ------------ | ------------ | ------------------------------------------------ |
| `/meal-plan` | `/`          | The weekly plan now lives on the Today dashboard |

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

1. Signed in as the review account, delete it on My account → Your data (`/account/data`).
2. `curl -X POST "http://localhost:3200/api/e2e-support?action=expire-purge&email=<review email>"` — back-dates its purge window.
3. `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3200/api/cron/purge-deleted-users` → `{"purged":1,"scanned":1}`. `$CRON_SECRET` is the value the server started with: `CRON_SECRET` from `.env`, or the fallback literal in `scripts/e2e-local.sh` when `.env` has none.
4. `curl "http://localhost:3200/api/e2e-support?action=user-state&email=<review email>"` → `{"exists":false}`.

**The purge cron purges every account whose deletion window has elapsed, not only the review account.** In `--db env` mode, check before step 3 that nothing else is due — `scanned` should be the number of review accounts you expired:

```sql
SELECT email, "purgeScheduledFor" FROM "user"
WHERE "deletedAt" IS NOT NULL AND "purgeScheduledFor" < now();
```
