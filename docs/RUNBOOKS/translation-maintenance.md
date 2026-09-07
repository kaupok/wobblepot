# Translation maintenance runbook

Operator reference for fixing seeded translations after launch (HON-517). [HON-499](https://linear.app/honkadori/issue/HON-499)'s principles include _"Content is data, not code — translations edit without deploys."_ This runbook is the mechanism behind that sentence: how a human fixes a wrong Estonian ingredient or meal name in a live database, and what they owe the next person afterward.

## Why this exists

Estonian shipped machine-quality by design. Awkward phrasings and outright typos will surface for months — from real use, from the native-variant review (HON-548), from the partner test (HON-512). Without a defined path, each one resolves badly:

1. **It rots.** The user sees it, nobody owns the fix.
2. **It becomes a deploy.** A one-word typo turns into a seed-script PR, CI, and a production release — which is precisely what "edit without deploys" rules out.
3. **It becomes undocumented prod SQL.** Fast, and untraceable a month later.

### Decision (locked 2026-09-07): documented SQL

Direct, scoped `UPDATE` statements against staging and then production, logged in this file. Zero new product surface, and it honours the principle. Two alternatives were considered and rejected: an in-product `/admin/translations` page (real cost — route, auth gate, CRUD plumbing — for a volume we do not yet have) and a seed-script PR workflow (violates the principle outright).

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

Unique on `("ingredientId", locale)`: one translation per ingredient per locale. Also indexed on `(locale, name)`, which the fuzzy ingredient matcher reads — see [Matching side effects](#matching-side-effects).

### `meal_translation` (`prisma/schema.prisma:384`)

| Column             | Type   | Edit?                                       |
| ------------------ | ------ | ------------------------------------------- |
| `id`               | `text` | **No** — cuid primary key.                  |
| `mealId`           | `text` | **No** — FK to `meal.id`.                   |
| `locale`           | `text` | **No** — see the warning below.             |
| `name`             | `text` | **Yes** — translated meal name.             |
| `description`      | `text` | **Yes**, nullable — translated description. |
| `preparationNotes` | `text` | **Yes**, nullable — translated prep notes.  |

Unique on `("mealId", locale)`.

> **Never `UPDATE` the `locale` column.** It is half of the unique key, so changing it does not "move" a translation — it re-keys the row. The locale you left loses its overlay (that ingredient silently falls back to English for every household on it), and the locale you moved into either gains a duplicate-key error or, worse, succeeds and shadows a translation that was already correct. To add a translation for a new locale, `INSERT` a new row; to remove one, that is a seed-data change.

### English is not in these tables

English is canonical and lives on the base row — `ingredient.name`, `meal.name` / `.description` / `.preparationNotes`. A typo in the **English** text is not a translation fix: it is a change to seeded content, which means a seed-script edit and a normal PR. This runbook covers overlays only.

The same boundary applies to household-scoped rows. AI- and user-created ingredients carry a non-null `ingredient."householdId"` and are stored in the creator's locale with no translation row at all. Do not hand-edit another household's content; promotion of a household row into the curated global pool is [HON-514](https://linear.app/honkadori/issue/HON-514)'s job.

## Getting a SQL prompt

Read [`database-recovery.md`](database-recovery.md) § Prerequisites first if you are unsure how to reach a database safely — it owns connection and recovery mechanics, and this runbook does not repeat them. The environments and the promotion path are in [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

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

Five steps. Run all five against staging, confirm the app renders what you expect, then run all five against production.

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
-- Meal: same shape.
SELECT t.id, t."mealId", t.locale, t.name AS et_name, m.name AS en_name
FROM meal_translation t
JOIN meal m ON m.id = t."mealId"
WHERE m.name ILIKE '%shakshuka%'
  AND t.locale = 'et';
```

Copy the returned `ingredientId` / `mealId` and the **current** `name` into a scratch note now. The current value is your rollback; there is no other copy of it once the `UPDATE` runs.

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
-- meal_translation: any subset of the three text columns in one statement.
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
- `UPDATE 2` or more — **stop.** With the unique on `("ingredientId", locale)` this should be unreachable; if you see it, your `WHERE` lost a clause. [Roll back](#one-row) using the value from step 1 and re-read the statement before trying again.

Inside an explicit transaction, `BEGIN; … ; ROLLBACK;` lets you see the count before committing. Worth it on production.

### 4. Check it in the app

The edit is live on the next request. There is no cache to purge and no deploy to run: translation reads go through Prisma per request (`ingredientTranslationsInclude` / `mealTranslationsInclude` in `src/lib/i18n/content.ts`), and nothing in `src/` uses `unstable_cache`, `use cache`, or a route `revalidate`.

The one lag: a browser that already has the page open keeps TanStack Query's cached response until it goes stale, which is 60 s by default (`src/lib/get-query-client.ts:7`). Reload, or wait a minute, before concluding an edit did not take.

Look at the actual surface — the shopping list for an ingredient name, the meal plan or meal detail for a meal name or description — on a household whose locale is `et`.

### 5. Log it

Every **production** edit gets a line in the [change log](#change-log) below, committed as a normal docs PR. Staging-only edits do not need an entry; they are rehearsal.

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

**Hide it from the selector** (`src/lib/i18n/locales.ts:23`). New households can no longer choose Estonian, and it is no longer auto-resolved from `Accept-Language` during onboarding. Households already set to `et` keep rendering Estonian — `KNOWN_LOCALES` still accepts it:

```diff
-export const PUBLIC_LOCALES = ['en', 'et'] as const
+export const PUBLIC_LOCALES = ['en'] as const
```

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

[HON-514](https://linear.app/honkadori/issue/HON-514) — promoting household-scoped ingredients into the curated global pool. That flow includes backfilling `ingredient_translation` rows for newly promoted ingredients, and it is **the same person's job**: whoever curates the global pool also fixes its translations. Expect these two to converge — if HON-514 ships an admin surface, translation editing likely moves there and this runbook becomes the fallback rather than the primary path (see the escalation note in [Why this exists](#why-this-exists)).

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

| Date         | Table                      | Entity (English)                          | Locale | Before → after                  | Why                                                                                         |
| ------------ | -------------------------- | ----------------------------------------- | ------ | ------------------------------- | ------------------------------------------------------------------------------------------- |
| _2026-01-01_ | _`ingredient_translation`_ | _Chickpeas (`cme4x2p9k0001abcd1234wxyz`)_ | _`et`_ | _`kikerhernes` → `kikerherned`_ | _Example row — format reference, not a real edit. Delete once this table has real entries._ |
