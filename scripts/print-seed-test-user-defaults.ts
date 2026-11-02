/**
 * Prints the seed's default fixture credentials as `KEY=value` lines, for
 * `scripts/e2e-local.sh` to export in branch mode (HON-1594).
 */
import { SEED_TEST_USER_DEFAULTS } from '../prisma/seed-test-user-defaults'

for (const [key, value] of Object.entries(SEED_TEST_USER_DEFAULTS)) {
  // eslint-disable-next-line no-console -- the shell reads stdout
  console.log(`${key}=${value}`)
}
