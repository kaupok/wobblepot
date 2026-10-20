// The line the seed prints before its first write, so a seed aimed at the wrong
// database is visible in any run (HON-1272). `prisma/seed.ts` loads .env with
// `dotenv/config`, which does not override a DATABASE_URL the shell already
// exports, so in a worktree the seed can target a different database than the
// one `.env` names.

/**
 * The host (and port) of a Postgres connection string. `URL.host` never holds
 * the user or the password, so the result is safe to log.
 */
export function seedTargetHost(url: string | undefined): string {
  if (!url) return '(DATABASE_URL is not set)'
  try {
    return new URL(url).host || '(no host in DATABASE_URL)'
  } catch {
    return '(DATABASE_URL does not parse as a URL)'
  }
}

export function seedTargetLine(url: string | undefined): string {
  return `[seed] Target database: ${seedTargetHost(url)}`
}
