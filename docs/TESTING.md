# Testing

How to write and run unit, database, route and E2E tests. CLAUDE.md → Testing holds the short rules; this file holds the detail each one needs. E2E tiers, selectors and the spec-header convention are in [`tests/e2e/README.md`](../tests/e2e/README.md).

## Unit and component tests

Vitest and Testing Library. Colocate a test with its source file, use `describe`/`it` and accessibility queries (`getByRole`), and test user-facing behaviour. Example: `src/components/ui/button.test.tsx`.

**A test must be able to fail.** Take expected values from a literal or the acceptance criteria, not from the logic under test; assert through the public interface, not on calls to an internal mock; and assert a specific value, not `toBeDefined()`. CI cannot see these, so `scripts/pr-review.sh` adds a reviewer checklist item when the diff touches a test, spec or story file.

**Test environment.** `.test.tsx` files run in jsdom (the `unit` project); `.test.ts` files run in node (`unit-node`), because booting a window per file was the largest cost in the unit step. A `.test.ts` file that needs a DOM (`renderHook`, `document`, `localStorage`) starts with `// @vitest-environment jsdom`; without it, it fails with `document is not defined` or similar.

**TanStack Query.** Components that use `useQuery` or `useMutation` need a `QueryClientProvider` wrapper. Use `createQueryWrapper()` from `src/test/query-wrapper.tsx`, which creates a fresh `QueryClient` per test with retries disabled.

## Database tests

A test that exercises a query is a `*.db.test.ts` next to the `src/lib` module it tests, with no `vi.mock`: a mock cannot catch a wrong query. The `unit-db` project runs it against PGlite, an in-process Postgres with every migration applied, and empties the tables before each test except the rows the migrations seed. Run it with `pnpm test:db`; it needs no `DATABASE_URL`, and `pnpm test` excludes it. `pnpm test:coverage` includes it. Example: `src/lib/household.db.test.ts`.

In that project `next-intl/server` resolves to `src/test/next-intl-server-shim.ts`, so a `src/lib` read that calls `getTranslations({ locale, namespace })` runs on the real catalogs. Pass the locale: the shim has no request to read one from. Example: `src/lib/shopping/load-shopping-list.db.test.ts`.

## Route tests

The route keeps the session, the household, body validation and the status map. Every query and the rules that act on rows go in a `src/lib` function that throws a typed error per refusal. Its `*.db.test.ts` proves the rows. The route test mocks only that `src/lib` module and asserts status and body. Reference: `src/app/api/meal-plans/[id]/entries/[entryId]/route.ts` and `src/lib/meal-plans/entries.ts`.

## Commands and coverage

`pnpm test`, `pnpm test:db`, `pnpm test:coverage`, `pnpm test:e2e`, `pnpm test:all`. CI runs `pnpm test:coverage`, which fails under the thresholds in `vitest.config.ts`; the ratchet rule is in [DEPLOYMENT.md](DEPLOYMENT.md) → CI Pipeline. `pnpm test:e2e:local` runs the E2E suite against a fresh, isolated Neon branch; `pnpm review:local` serves the app the same way for walking a flow by hand.

## E2E drift

When you modify a `page.tsx` under `src/app`, change a route's URL, rename navigation or CTA copy, or restructure a modal or dialog, grep `tests/e2e` for references and update the affected specs in the same PR. Use the per-spec `// ROUTES: … · COMPONENTS: …` header comments to scope the grep:

```bash
grep -l "ROUTES.*<route>\|COMPONENTS.*<Component>" tests/e2e/*.spec.ts
grep -rn "<exact old copy>" tests/e2e/   # for a copy rename
```

This is part of the definition of done. The tier 1 E2E check catches drift on `main`, but stale specs are cheap to miss locally and expensive to fix in batch. No CI check can enforce it, so `scripts/pr-review.sh` adds a reviewer checklist item when the diff touches a `.tsx` under `src/app` or `src/components`, a `messages/*.json` catalog, or `src/proxy.ts`. The reviewer is a backstop; the rule is yours to follow while writing the change.

## Driven screens

When a diff changes a page or a feature component, open each changed screen through the Playwright MCP on `pnpm review:local` before the PR, and record a `Driven:` line in the PR body. Storybook and the E2E grep are static, so they cannot see a dead button. The steps are in `/implement-issue` step 9 → "Drive changed screens". `scripts/pr-review.sh` adds a reviewer item when the line is missing.
