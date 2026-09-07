# Translation maintenance runbook

Operator reference for fixing seeded translations after launch (HON-517). [HON-499](https://linear.app/honkadori/issue/HON-499)'s principles include _"Content is data, not code — translations edit without deploys."_ This runbook is the mechanism behind that sentence: how a human fixes a wrong Estonian ingredient or meal name in a live database, and what they owe the next person afterward.

## Why this exists

Estonian shipped machine-quality by design. Awkward phrasings and outright typos will surface for months — from real use, from the native-variant review (HON-548), from the partner test (HON-512). Without a defined path, each one resolves badly:

1. **It rots.** The user sees it, nobody owns the fix.
2. **It becomes a deploy.** A one-word typo turns into a seed-script PR, CI, and a production release — which is precisely what "edit without deploys" rules out.
3. **It becomes undocumented prod SQL.** Fast, and untraceable a month later.

### Decision (locked 2026-09-07): documented SQL

Direct, scoped `UPDATE` statements against staging and then production, logged in this file. Zero new product surface. Two alternatives were considered: an in-product `/admin/translations` page (rejected — real cost in route, auth gate, and CRUD plumbing for a volume we do not yet have) and a seed-script PR workflow (rejected as the _primary_ path, because a one-word typo should not wait on CI and a deploy to stop being visible).

**SQL first, seed data after.** Implementing this runbook surfaced a constraint the decision was made without: the production deploy re-seeds, so a SQL edit alone is reverted at the next release. The `UPDATE` is what makes the fix visible today without a deploy; a follow-up PR is what makes it survive. [The seed re-asserts translations](#the-seed-re-asserts-translations) is the section to read before using this runbook.

**Re-evaluate when fix volume outgrows it.** The escalation is the admin page, sharing its authoring surface with the ingredient-promotion flow in [HON-514](https://linear.app/honkadori/issue/HON-514) if that lands first. The signal to watch: if the change log below starts collecting more than a handful of entries a month, or if a session routinely edits ten-plus rows at a time, the discipline this runbook depends on is being asked for more than it can give.

## Policy: this is a human at a terminal

From [`CLAUDE.md`](../../CLAUDE.md) → Database Patterns:

> **Never run destructive database commands (`migrate reset`, `db push --force-reset`, `DROP`, etc.) on staging or production.** These destroy real data. Always ask the user before taking any destructive action on shared environments — even to fix migration issues.

Carried over here with one addition, because this runbook is the first that asks for a hand-written `UPDATE` against production as its normal path:

- **Agents do not run these statements.** Not on production, not on staging, not "just to check the row exists". An agent may draft the SQL, and may propose a change-log entry; a human runs it and records the result. The whole audit story is one person, at a prompt, writing down what they did.
- **No unscoped writes.** Every `UPDATE` in this runbook carries both the foreign key and `locale` in its `WHERE`. See [Never run an unscoped UPDATE](#never-run-an-unscoped-update).
- **Nothing here deletes.** Fixing a translation is always an `UPDATE`. If a translation row genuinely should not exist, that is a seed-data change, not a maintenance edit.

## What you can edit

Two tables, both pure overlays on a canonical English base row. `prisma/schema.prisma` declares them as `IngredientTranslation` and `MealTranslation`; in Postgres they are `ingredient_translation` and `meal_translation` via `@@map`. **Use the SQL names below** — Prisma model names do not exist at a `psql` prompt, and the column identifiers are camelCase, so they must be double-quoted.

### `ingredient_translation` (`prisma/schema.prisma:344`)

| Column         | Type   | Edit?                                                                     |
| -------------- | ------ | ------------------------------------------------------------------------- |
| `id`           | `text` | **No** — cuid primary key.                                                |
| `ingredientId` | `text` | **No** — FK to `ingredient.id`. Repointing it rewrites what row this is.  |
| `locale`       | `text` | **No** — see the warning below.                                           |
| `name`         | `text` | **Yes** — the translated ingredient name. This is the whole editable set. |

Unique on `("ingredientId", locale)`: one translation per ingredient per locale. There is also a plain btree on `(locale, name)` (`ingredient_translation_locale_name_idx`), which serves the `locale` equality filter only — the fuzzy matcher's `similarity()` predicate cannot use it, and no trigram index exists on this table. See [Matching side effects](#matching-side-effects).

### `meal_translation` (`prisma/schema.prisma:384`)

| Column             | Type   | Edit?                                             |
| ------------------ | ------ | ------------------------------------------------- |
| `id`               | `text` | **No** — cuid primary key.                        |
| `mealId`           | `text` | **No** — FK to `meal.id`.                         |
| `locale`           | `text` | **No** — see the warning below.                   |
| `name`             | `text` | **Yes** — translated meal name.                   |
| `description`      | `text` | **Yes**, nullable — translated description.       |
| `preparationNotes` | `text` | **No** — always `null` on seeded rows; see below. |

Unique on `("mealId", locale)`.

`preparationNotes` looks editable and is not. The seed writes `null` into it in **both** the `create` and `update` branches (`prisma/seed.ts:3889`, `:3894`), so anything you put there is erased on the next production seed run. That is deliberate: seeded meals carry no English prep notes either, the meal-detail prep section is driven by the AI preparation-tips feature, and the column is reserved for user-authored notes, which keep their creator-time locale per HON-499's content principle. There is nothing to translate here.

> **Never `UPDATE` the `locale` column.** It is half of the unique key, so changing it does not "move" a translation — it re-keys the row. The locale you left loses its overlay — that ingredient silently falls back to English for every household on it — and the destination either already has a translation, so the write is rejected on the unique key, or does not, so you have moved Estonian text under another language's label. To add a translation for a new locale, `INSERT` a new row; to remove one, that is a seed-data change.

### English is not in these tables

English is canonical and lives on the base row — `ingredient.name`, `meal.name` / `.description` / `.preparationNotes`. A typo in the **English** text is not a translation fix: it is a change to seeded content, which means a seed-script edit and a normal PR. This runbook covers overlays only.

The same boundary applies to household-scoped rows. AI- and user-created ingredients carry a non-null `ingredient."householdId"` and are stored in the creator's locale with no translation row at all. Do not hand-edit another household's content; promotion of a household row into the curated global pool is [HON-514](https://linear.app/honkadori/issue/HON-514)'s job.

## Getting a SQL prompt

[`database-recovery.md`](database-recovery.md) owns recovery mechanics and is where you go if an edit goes wrong; its § "Neon branching recovery workflow" carries the worked `psql` invocations. This runbook does not repeat them. The environments and the promotion path are in [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

You want `DATABASE_URL_UNPOOLED` — the direct connection, not the pooled one ([`../ENVIRONMENT_SETUP.md`](../ENVIRONMENT_SETUP.md) § Variable reference). Pull it from Vercel rather than copying it out of a dashboard:

```bash
# Staging first. Always.
vercel env pull .env.staging --environment=staging
psql "$(grep '^DATABASE_URL_UNPOOLED=' .env.staging | cut -d= -f2- | tr -d '"')"
```

Prisma Studio works too, and is easier for a one-cell edit — but it gives you no statement to paste into the change log, so you have to write down the before-value yourself:

```bash
DATABASE_URL_UNPOOLED="<the unpooled URL>" pnpm db:studio
```

`prisma.config.ts` points the CLI at `DATABASE_URL_UNPOOLED`, so Studio follows whatever you set there.

**Delete the pulled env file when you are done.** `.env.staging` and `.env.production` hold live database credentials. `.gitignore` covers them (`.env*`, `.gitignore:36`) so they cannot be committed by accident, but they should not sit on disk either:

```bash
rm -f .env.staging .env.production
```

## Procedure

Six steps. Run steps 1-4 against staging first, confirm the app renders what you expect, then run steps 1-5 against production. Step 6 is a follow-up PR and is what makes the fix permanent — [do not skip it](#the-seed-re-asserts-translations).

### 1. Find the row and record the current value

Never edit a row you have not looked at. Join through the base row so you can search by the English name you actually know:

```sql
-- Ingredient: find the Estonian overlay for an ingredient you know in English.
SELECT t.id, t."ingredientId", t.locale, t.name AS et_name, i.name AS en_name
FROM ingredient_translation t
JOIN ingredient i ON i.id = t."ingredientId"
WHERE i.name ILIKE '%chickpea%'
  AND i."householdId" IS NULL   -- global pool only; household rows are not ours to edit
  AND t.locale = 'et';
```

```sql
-- Meal: same shape. Select both editable columns, not just the one you came
-- to fix — see the note below.
SELECT t.id, t."mealId", t.locale,
       t.name, t.description,
       m.name AS en_name
FROM meal_translation t
JOIN meal m ON m.id = t."mealId"
WHERE m.name ILIKE '%shakshuka%'
  AND m."householdId" IS NULL   -- seeded meals only; household meals are not ours to edit
  AND t.locale = 'et';
```

Copy the returned `ingredientId` / `mealId` and **every column you are about to write** into a scratch note now. Those values are your rollback; there is no other copy of them once the `UPDATE` runs.

> **Record every column you intend to `SET`, not just the obvious one.** A single `UPDATE` on `meal_translation` may touch `name` and `description` together (step 2 does exactly that). A before-value you did not select is a column you cannot roll back — the query above returns both for that reason.

If the query returns no rows, there is no translation to fix — the surface is falling back to English because the overlay was never seeded. That is a seeding gap, not a maintenance edit.

### 2. Update, scoped by foreign key and locale

```sql
-- Expect exactly 1 row updated.
UPDATE ingredient_translation
SET name = 'kikerherned'
WHERE "ingredientId" = 'cme4x2p9k0001abcd1234wxyz'
  AND locale = 'et';
```

```sql
-- meal_translation: both editable columns in one statement.
UPDATE meal_translation
SET name = 'Šakšuka',
    description = 'Munad vürtsikas tomatikastmes.'
WHERE "mealId" = 'cme4x2p9k0002abcd1234wxyz'
  AND locale = 'et';
```

Both halves of the `WHERE` are load-bearing. `"ingredientId"` alone would rewrite every locale's overlay for that ingredient the moment a second locale exists; `locale` alone rewrites every row in the language.

### 3. Verify the row count

`psql` prints `UPDATE 1`. That is the check — do not skip it.

- `UPDATE 1` — done.
- `UPDATE 0` — the `WHERE` matched nothing. Wrong id, or wrong locale. Go back to step 1; do not loosen the `WHERE` to make it match.
- `UPDATE 2` or more — **stop, and do not "fix it" with another `UPDATE`.** Read this count as catalogue-wide damage, not an off-by-one. Estonian is the only seeded locale and there is one row per entity, so dropping `AND locale = 'et'` would still have matched a single row. A count above 1 therefore means the **foreign key** clause was lost — the [unscoped `UPDATE`](#never-run-an-unscoped-update) below, which rewrites every Estonian name in the catalogue to the same string. Step 1 recorded one before-value; the other several hundred are gone. The [one-row rollback](#one-row) repairs the row you were looking at and leaves the rest wrong, which is worse than the original typo because nothing now points at the damage. Treat it as an incident: go to [`database-recovery.md`](database-recovery.md) for PITR **immediately**, inside the 24-hour window, and log what happened in the [change log](#change-log) either way.

Inside an explicit transaction, `BEGIN; … ; ROLLBACK;` lets you see the count before committing. Worth it on production.

### 4. Check it in the app

The edit is live on the next request. There is no cache to purge and no deploy to run: translation reads go through Prisma per request (`ingredientTranslationsInclude` / `mealTranslationsInclude` in `src/lib/i18n/content.ts`), and nothing in `src/` uses `unstable_cache`, `use cache`, or a route `revalidate`.

The one lag: a browser that already has the page open keeps TanStack Query's cached response until it goes stale, which is 60 s by default (`src/lib/get-query-client.ts:7`). Reload, or wait a minute, before concluding an edit did not take.

Look at the actual surface — the shopping list for an ingredient name, the meal plan or meal detail for a meal name or description — on a household whose locale is `et`.

### 5. Log it

Every **production** edit gets a line in the [change log](#change-log) below, committed as a normal docs PR. Staging-only edits do not need an entry; they are rehearsal.

### 6. Mirror the edit into the seed data

Edit the matching entry in `prisma/seed-ingredient-translations-et.ts` or `prisma/seed-meal-translations-et.ts` to the value you just wrote, and open a PR — steps 5 and 6 travel together in one PR comfortably. Without it the next production deploy reverts your edit; [the section below](#the-seed-re-asserts-translations) explains why.

## The seed re-asserts translations

**A SQL edit alone does not survive the next production deploy.** This is the single most important constraint in this runbook.

`prisma/seed.ts` upserts every seeded translation from checked-in data files, and both upserts carry a live `update` branch — not `create`-only:

- `prisma/seed.ts:3945` — `ingredientTranslation.upsert(... update: { name: et })`
- `prisma/seed.ts:3876` — `mealTranslation.upsert(... update: { name, description, preparationNotes: null })`

`.github/workflows/deploy-db-migrations-production.yml:71` runs `pnpm db:seed` against production with no `if:` gate, and [`../DEPLOYMENT.md`](../DEPLOYMENT.md) § Production Deployment Process makes that workflow **step 4a of every production release**. So the sequence is:

1. You fix `kikerhernes` → `kikerherned` with a scoped `UPDATE`. Users see the correct word immediately.
2. Someone ships an unrelated feature three weeks later.
3. Step 4a runs `pnpm db:seed`, the upsert's `update` branch rewrites the row from `prisma/seed-ingredient-translations-et.ts`, and the typo is back.
4. The change log still says it was fixed. Nothing reports the regression.

### So: mirror every production edit into the seed data

The data files are the durable source of truth:

| Table                    | Seed data file                              |
| ------------------------ | ------------------------------------------- |
| `ingredient_translation` | `prisma/seed-ingredient-translations-et.ts` |
| `meal_translation`       | `prisma/seed-meal-translations-et.ts`       |

Edit the matching entry to the value you just wrote in SQL, and ship it as a normal docs-sized PR. It needs no coordination with the SQL edit and no deploy of its own — it just has to land **before** the next production seed run, and the seed is idempotent, so the two agreeing is a no-op.

Until that PR merges, the fix is live but provisional. That is the trade this workflow makes deliberately: the user stops seeing the typo today, and the durability lands on the normal review cadence instead of blocking on it.

## Never run an unscoped UPDATE

```sql
-- Do not do this. Ever.
UPDATE ingredient_translation SET name = 'kikerherned' WHERE locale = 'et';
```

That statement rewrites every Estonian ingredient name in the database to the same word. There is no undo: the previous values existed only in the rows you just overwrote, and recovering them means point-in-time recovery from a Neon backup ([`database-recovery.md`](database-recovery.md)) inside a 24-hour window — a full incident for a typo fix.

The habit that prevents it is mechanical, not clever: **write the `WHERE` clause before the `SET` clause.** Both keys, every time.

## Rollback

### One row

Re-run the `UPDATE` from step 2 with the value you recorded in step 1:

```sql
UPDATE ingredient_translation
SET name = '<the value recorded in step 1>'
WHERE "ingredientId" = 'cme4x2p9k0001abcd1234wxyz'
  AND locale = 'et';
```

This is the entire reason step 1 records the old value. If you did not record it, the row's previous content is gone from the live database and the only recourse is PITR — see [`database-recovery.md`](database-recovery.md), and act inside the 24-hour window.

Add a second change-log line for the revert. Do not edit or delete the original entry; the log is append-only, and "this was changed and then changed back" is exactly the history a future reader needs.

### A whole locale

If Estonian itself has to come off — a systemic quality problem, not a typo — there is **no runtime flag**. [HON-549](https://linear.app/honkadori/issue/HON-549) retired `FEATURE_PUBLIC_LOCALES_FULL`, so pulling a locale is a code change plus a deploy. Two levers, different blast radii:

**Hide it from the selector** (`src/lib/i18n/locales.ts:23`). Households already set to `et` keep rendering Estonian — `KNOWN_LOCALES` still accepts it:

```diff
-export const PUBLIC_LOCALES = ['en', 'et'] as const
+export const PUBLIC_LOCALES = ['en'] as const
```

**This lever is weaker than it looks — it is not sufficient on its own, and it is not inert either.** It removes the locale from the settings selector; households already on `et` then render a **blank** locale control, because `HouseholdSettingsForm.tsx:300` binds `value={locale}` against items built from `PUBLIC_LOCALES` (`:308`) behind a bare `<SelectValue />` with no placeholder. Meanwhile onboarding still auto-resolves Estonian from `Accept-Language` and persists it: `resolveLocale` gates on `isKnownLocale`, and `POST /api/households` writes the result without clamping it to `PUBLIC_LOCALES` (`src/app/api/households/route.ts:50`, whose comment says a clamp is unneeded _because_ the two sets are equal today — which is exactly the assumption this edit breaks). `isPublicLocale` has no non-test callers. So an Estonian-preferring browser still lands in Estonian after this change. If the goal is "no new households get Estonian", you need `KNOWN_LOCALES` below, or a clamp added to that route first.

**Revert every household to English chrome** (`src/lib/i18n/locales.ts:15`) — the rollback lever named in HON-499's principles:

```diff
-export const KNOWN_LOCALES = ['en', 'et'] as const
+export const KNOWN_LOCALES = ['en'] as const
```

This works because `resolveLocale` gates the stored household locale through `isKnownLocale` (`src/lib/i18n/resolve-locale.ts:18`). With `et` no longer known, a household still holding `locale = 'et'` falls through to `Accept-Language` — itself filtered by the same guard — and then to `DEFAULT_LOCALE`. Every surface renders English. Nothing throws; the revert is silent by construction.

Either way: **no data is lost.** `Household.locale` keeps its `'et'` value and every `ingredient_translation` / `meal_translation` row stays in the database, so re-enabling is the reverse one-line diff — nothing to re-seed.

One asymmetry worth knowing before you pull `KNOWN_LOCALES`: reads fall back silently, but **writes reject**. `PATCH /api/households/me` validates `locale` against `z.enum(KNOWN_LOCALES)` (`src/app/api/households/me/route.ts:18`), so any client still sending `'et'` gets a 400 rather than a fallback. Exercise this lever on staging first.

Ship either through the normal production path in [`../DEPLOYMENT.md`](../DEPLOYMENT.md) § Production Deployment Process — this is a code change, so it is a deploy, not a SQL edit.

## Matching side effects

Translation names are not display-only. `fuzzySearchIngredient` (`src/lib/ai/fuzzy-ingredient-match.ts`) searches `ingredient_translation` to resolve AI- and parser-produced Estonian ingredient names back to canonical global ingredients — that is what the `(locale, name)` index is for. It is a `pg_trgm` `similarity()` match above a threshold, not an exact one, and a global (canonical English) match always outranks a translation match.

So an edit shifts matching as well as rendering, in both directions:

- **Fixing a wrong translation improves matching.** A parsed Estonian recipe starts resolving the right word to the right global ingredient instead of minting a household-scoped duplicate.
- **Moving a name far from what users type can lose matches.** Trigram similarity is forgiving about inflection but not about a different word — replacing a common term with a precise-but-unused one drops it below the threshold, and recipes using the common term create household-scoped rows instead.

Neither is a reason to avoid the edit. It is a reason to prefer the word a user would actually type over the most technically correct one, and to say so in the change-log `why` when you knowingly trade recall for accuracy.

## Adjacent work

[HON-514](https://linear.app/honkadori/issue/HON-514) — promoting household-scoped ingredients into the global pool — backfills `ingredient_translation` rows for the ingredients it promotes, and it is **the same person's job**: whoever curates the pool also fixes its translations.

## Reference

- Tables: `prisma/schema.prisma:344` (`IngredientTranslation`), `:384` (`MealTranslation`)
- Read path: `src/lib/i18n/content.ts` — `ingredientTranslationsInclude` / `mealTranslationsInclude`
- Locale sets: `src/lib/i18n/locales.ts` — `KNOWN_LOCALES` (`:15`), `PUBLIC_LOCALES` (`:23`)
- Ingredient matching: `src/lib/ai/fuzzy-ingredient-match.ts`
- Localization overview: [`../LOCALIZATION.md`](../LOCALIZATION.md)
- Connections, PITR, failure-mode playbooks: [`database-recovery.md`](database-recovery.md)
- Environments and the production promotion path: [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
- `DATABASE_URL_UNPOOLED`: [`../ENVIRONMENT_SETUP.md`](../ENVIRONMENT_SETUP.md) § Variable reference

## Change log

One line per **production** translation edit. Append at the bottom, newest last. Include the entity's English name alongside its id — the id alone is unreadable a month later.

The **Seed PR** column is the audit for [step 6](#6-mirror-the-edit-into-the-seed-data). Write `pending` when you log the SQL edit, and fill in the PR number when the mirror lands. A row still reading `pending` is a fix that the next production deploy will silently revert — that column is the only place anyone would notice.

| Date         | Table                      | Entity (English)                          | Locale | Before → after                  | Seed PR | Why                                                                                         |
| ------------ | -------------------------- | ----------------------------------------- | ------ | ------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| _2026-01-01_ | _`ingredient_translation`_ | _Chickpeas (`cme4x2p9k0001abcd1234wxyz`)_ | _`et`_ | _`kikerhernes` → `kikerherned`_ | _#000_  | _Example row — format reference, not a real edit. Delete once this table has real entries._ |
