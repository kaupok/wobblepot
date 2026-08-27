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

Regenerated from `find src/app -name page.tsx` on 2026-08-27. Route groups such as `(legal)` are stripped from the paths; `/api/*` route handlers are excluded.

**Access** is derived from each page's server code:

- **Public** — renders without a session.
- **Auth** — calls `auth.api.getSession()` and redirects to `/sign-in` when signed out. Most Auth pages also require a household: without one they redirect to `/onboarding` (and `/onboarding` itself redirects to `/` once you have one).
- **Admin** — Auth plus `isAdmin(session)`; non-admins get a 404, not a redirect.

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
| `/shopping`              | Auth          | Shopping list (urgency grouping) plus pantry inventory                                             |
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
| `/pantry`            | `/shopping`  | Pantry inventory now lives on the shopping page            |
| `/household/invites` | `/household` | Invites are managed in the Members section of `/household` |
