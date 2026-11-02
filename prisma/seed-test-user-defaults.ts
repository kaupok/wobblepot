/**
 * Default credentials for the E2E fixture users `seedTestUsers()` creates,
 * keyed by the env var that overrides each one. CI passes its own values as
 * secrets; `scripts/e2e-local.sh` exports these on a throwaway branch so
 * smoke-fixture specs run locally instead of skipping (HON-1594).
 *
 * No imports and no side effects: the shell reads this through
 * `scripts/print-seed-test-user-defaults.ts`, without loading the seed.
 */
export const SEED_TEST_USER_DEFAULTS = {
  SMOKE_TEST_EMAIL: 'smoke@test.honkadori.local',
  SMOKE_TEST_PASSWORD: 'smoke-test-pass-1234',
  FORGOT_PASSWORD_TEST_EMAIL: 'forgot-password@test.honkadori.local',
  FORGOT_PASSWORD_TEST_PASSWORD: 'forgot-pass-test-1234',
} as const
