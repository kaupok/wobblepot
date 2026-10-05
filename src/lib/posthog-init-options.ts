import type { PostHogConfig } from 'posthog-js'
import { POSTHOG_URL_MASKING, postHogBeforeSend } from '@/lib/posthog-before-send'
import { POSTHOG_PROXY_PATH, POSTHOG_UI_HOST } from '@/lib/posthog-proxy'

/**
 * `posthog.init` options shared by `PostHogProvider` and the crash page
 * (`src/app/global-error.tsx`). Whichever init runs first wins: posthog-js
 * no-ops a second init, so an option missing from one of them (the sanitiser,
 * say) is missing for the rest of the session. Callers spread this object and
 * add only what differs (`bootstrap` in the provider).
 *
 * The `posthog-js` import is type-only, so this module does not pull the SDK
 * into the bundle; both callers still load it with a dynamic `import()`.
 */
export const POSTHOG_INIT_OPTIONS = {
  api_host: POSTHOG_PROXY_PATH,
  ui_host: POSTHOG_UI_HOST,
  person_profiles: 'identified_only',
  // App Router pageviews are captured by hand in PostHogProvider's PostHogPageView.
  capture_pageview: false,
  // The SDK default ('if_capture_pageview') follows capture_pageview, which is off above.
  capture_pageleave: true,
  disable_session_recording: true,
  // Surveys are not used (HON-478 cancelled), so the SDK should not fetch surveys.js.
  disable_surveys: true,
  // Pinned so the project's remote toggle cannot change behaviour: a local
  // object takes precedence over it. Unhandled errors outside a React boundary
  // otherwise never reach the `$exception` error-spike alert.
  capture_exceptions: {
    capture_unhandled_errors: true,
    capture_unhandled_rejections: true,
    capture_console_errors: false,
  },
  // Makes opt_out_capturing() delete the stored identity (HON-1002). Without
  // it, opt-out only stops capture and the ph_* cookie and localStorage entry
  // keep the distinct id. posthog-js 1.435.8: opt_out_capturing() calls
  // _sync_opt_out_with_persistence() (lib/src/posthog-core.js:4152), which
  // disables persistence only when _is_persistence_disabled() is true
  // (posthog-core.js:4143-4151: opted out and this option set), and
  // set_disabled(true) removes the cookie, localStorage and sessionStorage
  // entries (lib/src/posthog-persistence.js:1706). An opted-in client persists
  // as before.
  opt_out_persistence_by_default: true,
  defaults: '2026-01-30',
  before_send: postHogBeforeSend,
  ...POSTHOG_URL_MASKING,
} satisfies Partial<PostHogConfig>
