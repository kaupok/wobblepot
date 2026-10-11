/**
 * Whether search engines may index this deployment (HON-1159).
 *
 * Only production is indexable. Staging (`wobblepot.dev`) and preview
 * deployments are copies of `wobblepot.com`, so an indexed copy competes with
 * production in search results and lets a searcher sign up on staging.
 * `NEXT_PUBLIC_APP_ENV` is inlined at build time and each Vercel environment
 * builds separately, so a build-time check is correct.
 *
 * The response header (`next.config.ts`), `src/app/robots.ts` and
 * `src/app/sitemap.ts` all read this one check, so they cannot disagree.
 *
 * No `@/` imports: `next.config.ts` imports this file by relative path.
 */

/** Unset or unknown is not indexable: a misconfigured deploy stays out of search. */
export function isIndexable(appEnv: string | undefined): boolean {
  return appEnv === 'production'
}

/**
 * Headers for every response. Non-production gets `noindex`, which Google
 * reads only from a page it was allowed to fetch, so robots.txt keeps crawling
 * allowed there rather than adding a `Disallow: /`.
 */
export function noindexHeaders(appEnv: string | undefined): { key: string; value: string }[] {
  return isIndexable(appEnv) ? [] : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]
}
