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
