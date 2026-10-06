# Translation maintenance runbook

Operator reference for fixing seeded translations after launch (HON-517). [HON-499](https://linear.app/honkadori/issue/HON-499)'s principles include _"Content is data, not code — translations edit without deploys."_ This runbook is the mechanism behind that sentence: how a human fixes a wrong Estonian ingredient or meal name in a live database, and what they owe the next person afterward.

## Why this exists

Estonian shipped machine-quality by design. Awkward phrasings and outright typos will surface for months — from real use and from the native-speaker copy review (HON-536, which absorbed the ingredient native-variant review, HON-548). Without a defined path, each one resolves badly:

1. **It rots.** The user sees it, nobody owns the fix.
2. **It becomes a deploy.** A one-word typo turns into a seed-script PR, CI, and a production release — which is precisely what "edit without deploys" rules out.
3. **It becomes undocumented prod SQL.** Fast, and untraceable a month later.

### Decision (locked 2026-09-07): documented SQL

Direct, scoped `UPDATE` statements against staging and then production, logged in this file. Zero new product surface. Two alternatives were considered: an in-product `/admin/translations` page (rejected — real cost in route, auth gate, and CRUD plumbing for a volume we do not yet have) and a seed-script PR workflow (rejected as the _primary_ path, because a one-word typo should not wait on CI and a deploy to stop being visible).

**SQL first, seed data after.** Implementing this runbook surfaced a constraint the decision was made without: the production deploy re-seeds, so a SQL edit alone is reverted at the next release. The `UPDATE` is what makes the fix visible today without a deploy; a follow-up PR is what makes it survive. [The seed re-asserts translations](#the-seed-re-asserts-translations) is the section to read before using this runbook.

**Re-evaluate when fix volume outgrows it.** The escalation would be tooling for bulk edits, and its form is not chosen. For the related job of promoting household-scoped ingredients into the global pool, the stated preference is a mechanism the operator runs through Claude Code (a script or skill in the repo) rather than an admin page; see [`LOCALIZATION.md`](../LOCALIZATION.md#decided-principles). The signal to watch: if the change log below starts collecting more than a handful of entries a month, or if a session routinely edits ten-plus rows at a time, the discipline this runbook depends on is being asked for more than it can give.

## Policy: this is a human at a terminal

From [`CLAUDE.md`](../../CLAUDE.md) → Database Patterns:

> **Destructive commands:** do not run `migrate reset`, `db push --force-reset`, `DROP` or similar against staging or production. They destroy real data. Ask the user before any destructive action on a shared environment, even to fix a migration problem, and prefer `migrate resolve` or a manual SQL fix. The PreToolUse hook blocks the common forms (see Git & Workflow Essentials → Hooks).

Carried over here with one addition, because this runbook is the first that asks for a hand-written `UPDATE` against production as its normal path:

- **Agents do not run these statements.** Not on production, not on staging, not "just to check the row exists". An agent may draft the SQL, and may propose a change-log entry; a human runs it and records the result. The whole audit story is one person, at a prompt, writing down what they did.
- **No unscoped writes.** Every `UPDATE` in this runbook carries both the foreign key and `locale` in its `WHERE`. See [Never run an unscoped UPDATE](#never-run-an-unscoped-update).
- **Nothing here deletes.** Fixing a translation is always an `UPDATE`. If a translation row genuinely should not exist, that is a seed-data change, not a maintenance edit.

## What you can edit

Two tables, both pure overlays on a canonical English base row. `prisma/schema.prisma` declares them as `IngredientTranslation` and `MealTranslation`; in Postgres they are `ingredient_translation` and `meal_translation` via `@@map`. **Use the SQL names below** — Prisma model names do not exist at a `psql` prompt, and the column identifiers are camelCase, so they must be double-quoted.

### `ingredient_translation` (`prisma/schema.prisma:355`)

| Column         | Type   | Edit?                                                                     |
| -------------- | ------ | ------------------------------------------------------------------------- |
| `id`           | `text` | **No** — cuid primary key.                                                |
| `ingredientId` | `text` | **No** — FK to `ingredient.id`. Repointing it rewrites what row this is.  |
| `locale`       | `text` | **No** — see the warning below.                                           |
| `name`         | `text` | **Yes** — the translated ingredient name. This is the whole editable set. |

Unique on `("ingredientId", locale)`: one translation per ingredient per locale. There is also a plain btree on `(locale, name)` (`ingredient_translation_locale_name_idx`), which serves the `locale` equality filter only — the fuzzy matcher's `similarity()` predicate cannot use it, and no trigram index exists on this table. See [Matching side effects](#matching-side-effects).

### `meal_translation` (`prisma/schema.prisma:407`)

| Column             | Type   | Edit?                                             |
| ------------------ | ------ | ------------------------------------------------- |
| `id`               | `text` | **No** — cuid primary key.                        |
| `mealId`           | `text` | **No** — FK to `meal.id`.                         |
| `locale`           | `text` | **No** — see the warning below.                   |
| `name`             | `text` | **Yes** — translated meal name.                   |
| `description`      | `text` | **Yes**, nullable — translated description.       |
| `preparationNotes` | `text` | **No** — always `null` on seeded rows; see below. |

Unique on `("mealId", locale)`.

`preparationNotes` looks editable and is not. The seed writes `null` into it in **both** the `create` and `update` branches (`prisma/seed.ts:3898`, `:3903`), so anything you put there is erased on the next production seed run. That is deliberate: seeded meals carry no English prep notes either, the meal-detail prep section is driven by the AI preparation-tips feature, and the column is reserved for user-authored notes, which keep their creator-time locale per HON-499's content principle. There is nothing to translate here.

> **Never `UPDATE` the `locale` column.** It is half of the unique key, so changing it does not "move" a translation — it re-keys the row. The locale you left loses its overlay — that ingredient silently falls back to English for every household on it — and the destination either already has a translation, so the write is rejected on the unique key, or does not, so you have moved Estonian text under another language's label. To add a translation for a new locale, `INSERT` a new row; to remove one, that is a seed-data change.

### English is not in these tables

English is canonical and lives on the base row — `ingredient.name`, `meal.name` / `.description` / `.preparationNotes`. A typo in the **English** text is not a translation fix: it is a change to seeded content, which means a seed-script edit and a normal PR. A typo in an English **name** is a rename, and needs a migration as well; see [Renaming a seeded ingredient or meal](#renaming-a-seeded-ingredient-or-meal). This runbook covers overlays only.

The same boundary applies to household-scoped rows. The schema allows an ingredient with a non-null `ingredient."householdId"`, and the matcher and display handle one, but nothing creates them today: no code path writes an `ingredient` row at runtime, the recipe parser's unmatched rows must be resolved to an existing ingredient, and `POST /api/households/me/meals` rejects unknown ingredient ids. Household meals do exist; do not hand-edit another household's content. There is no path that promotes a household row into the curated global pool (see [`LOCALIZATION.md`](../LOCALIZATION.md#decided-principles)).

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

**Delete the pulled env file when you are done.** `.env.staging` and `.env.production` hold live database credentials. `.gitignore` covers them (`.env*`, `.gitignore:38`) so they cannot be committed by accident, but they should not sit on disk either:

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

- `prisma/seed.ts:3954` — `ingredientTranslation.upsert(... update: { name: et })`
- `prisma/seed.ts:3885` — `mealTranslation.upsert(... update: { name, description, preparationNotes: null })`

`.github/workflows/deploy-db-migrations-production.yml:71` runs `pnpm db:seed` against production with no `if:` gate, and [`../DEPLOYMENT.md`](../DEPLOYMENT.md) § Production Deployment Process makes that workflow **step 4a of every production release**. The workflow is manual, though: it runs only when the operator starts it, and `deploy-code-production.yml` does not depend on it, so a release that skips step 4a ships code without re-seeding. "Every release" holds only as long as step 4a is followed. So the sequence is:

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

### What the seed does not re-assert

Translations are re-asserted in full. The base rows are not:

- **An existing ingredient** gets only `gramsPerPiece` refreshed (`seedIngredients` in `prisma/seed.ts`). Its category, nutrition and allergens keep whatever the row first got.
- **An existing meal** gets its description, time, `kidFriendly`, `suitableFor` and protein type refreshed (`seedMeals`). Its name and components are never touched.
- **Both are looked up by exact English name** among the global rows. A row whose name is no longer in the seed data is left alone, not deleted.

## Renaming a seeded ingredient or meal

Changing a seeded English name in the seed data alone breaks the next production seed. The seed looks the new name up, finds nothing, and creates a second global row; the old row stays. The translation step then reconciles every live global row against the translation file, finds no key for one of the two names, and throws `Missing et translation`. That failure lands in the production migration workflow, after the migrations have applied. Keeping both keys would avoid the throw, but `pnpm db:validate` fails on the orphaned old key, and the old row would keep its own references and show up twice in search.

So rename the row in place, in **one PR**:

1. **Seed data.** Change the name in its `prisma/seed*.ts` file, and in every meal component that references it (for an ingredient).
2. **Translation key.** Change the `en` (ingredient) or `enName` (meal) key in `prisma/seed-ingredient-translations-et.ts` or `prisma/seed-meal-translations-et.ts`. Leave the Estonian value alone unless that is also the point of the PR. Do not keep the old key.
3. **Forward migration.** Add a migration (`pnpm db:migrate --create-only`, then write the SQL) that renames the global row:

   ```sql
   -- Rename a seeded global ingredient in place (HON-NNN). Same id, so meal
   -- components, pantry rows, shopping items and translations follow it.
   UPDATE "ingredient"
   SET "name" = 'new name'
   WHERE "name" = 'old name'
     AND "householdId" IS NULL;
   ```

   For a meal, the same statement on `"meal"`. A database that never had the old row (a fresh CI or Neon branch) updates nothing, and the seed then creates the row under its new name.

4. **Other references.** Grep `src/`, `scripts/`, `tests/` and `prisma/seed*.ts` for the old name. `src/lib/ingredient-aliases.ts` is the usual hit. Add the old name to `INGREDIENT_SYNONYMS` there, pointing at the new one: the matcher then still resolves text that uses it, and the ingredient search still finds the row by it and shows it in brackets (HON-1100). Move any `INGREDIENT_ALIASES` entry that targets the old name to the new name. Leave the old name in applied migrations: they are immutable, and the rename migration runs after them.
5. **Check.** `pnpm db:validate` passes. To rehearse the deploy order, run `pnpm test:e2e:local`: it branches from staging, which still has the old row, then migrates and seeds.

This works because every environment applies migrations before it seeds. `prisma migrate deploy` runs ahead of `pnpm db:seed` in `deploy-db-migrations-production.yml` and `deploy-db-migrations-staging.yml`, and in CI's E2E job, so by the time the seed looks for the new name the row already carries it. Staging re-seeds only when `prisma/seed*.ts` or the schema changed, which a rename PR always does.

**If the new name already exists as a global row**, this is a merge, not a rename. For an ingredient the `UPDATE` fails on `ingredient_global_name_key`; for a meal nothing stops it, because meal names carry no unique index, and you get two global meals with one name. Check before writing the migration. A merge repoints every foreign key to the surviving id (for an ingredient: `meal_component`, `pantry_item` and `custom_shopping_item`, the first two with a unique key to collide on) and deletes the old row. Plan it as its own issue.

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

**Hide it from the selector** (`src/lib/i18n/locales.ts:24`). Households already set to `et` keep rendering Estonian — `KNOWN_LOCALES` still accepts it:

```diff
-export const PUBLIC_LOCALES = ['en', 'et'] as const
+export const PUBLIC_LOCALES = ['en'] as const
```

**This lever is weaker than it looks — it is not sufficient on its own, and it is not inert either.** It removes the locale from the settings selector; households already on `et` still see their locale's label in the control, because `HouseholdSettingsForm.tsx:331` renders `localeOption.${locale}` explicitly, but the option list (`:334`) is built from `PUBLIC_LOCALES`, so a household that switches away cannot switch back. Meanwhile onboarding still auto-resolves Estonian from `Accept-Language` and persists it: `resolveLocale` gates on `isKnownLocale`, and `POST /api/households` writes the result without clamping it to `PUBLIC_LOCALES` (`src/app/api/households/route.ts:63-67`, whose comment says a clamp is unneeded _because_ the two sets are equal today — which is exactly the assumption this edit breaks). `isPublicLocale` has one non-test caller, `src/lib/emails/locale.ts:28`, and it is not on the onboarding path: it makes transactional email fall back to English for `et` households as soon as `et` leaves `PUBLIC_LOCALES`. So an Estonian-preferring browser still lands in Estonian after this change, with Estonian chrome and English email. If the goal is "no new households get Estonian", you need `KNOWN_LOCALES` below, or a clamp added to that route first.

**Revert every household to English chrome** (`src/lib/i18n/locales.ts:15`) — the rollback lever named in HON-499's principles:

```diff
-export const KNOWN_LOCALES = ['en', 'et'] as const
+export const KNOWN_LOCALES = ['en'] as const
```

This works because every server read of the household's locale goes through `resolveHouseholdLocale` (`src/lib/i18n/resolve-locale.ts`), which gates the stored value on `isKnownLocale` and returns `DEFAULT_LOCALE` when it fails (HON-921). With `et` no longer known, a household still holding `locale = 'et'` resolves to English on every path:

- **Chrome.** `resolveLocale` applies the same rule, so the household gets English even when its browser sends `Accept-Language: et`. The header is read only for a user with no household.
- **Content.** The timeline, pantry, shopping list, recipe library and meal detail request no translation rows and render the English names. `translateIngredient` / `translateMeal` and the `*TranslationsInclude` helpers in `src/lib/i18n/content.ts` also treat an unknown locale as the default, as a backstop.
- **AI.** Plan generation, imagine, quantity review, recipe parsing and preparation tips get English prompts: `localeInstruction` returns an empty string for an unknown locale, and the `estonianVoiceFor*` helpers return one once `et` is not known.
- **Email** already falls back to English, since `resolveEmailLocale` checks `PUBLIC_LOCALES`.

Nothing throws; the revert is silent by construction. `src/lib/i18n/locale-rollback.test.ts` simulates it with a household on an unknown locale.

What the lever does not revert:

- **Stored AI output.** Preparation tips already cached on an entry (`MealPlanEntry.preparationTips`) stay in Estonian until that entry's cache is cleared (a meal swap, a serving change, a meal edit, a membership change or a locale PATCH). Tips generated _during_ the rollback are English and are deliberately not cached, because the cache guard compares the stored `'et'`, which the rollback does not move; caching them would leave English tips behind after the re-enable. Each open of an uncached entry therefore regenerates, within the `meal-prep-tips` rate limit. Imagined meals and imported recipes were saved in Estonian and stay that way, like any user-created content.
- **A browser tab already open.** It keeps its TanStack Query cache until a reload or the 60-second `staleTime`.

Either way: **no data is lost.** `Household.locale` keeps its `'et'` value (unless an owner saves settings meanwhile; see below) and every `ingredient_translation` / `meal_translation` row stays in the database, so re-enabling is the reverse one-line diff — nothing to re-seed.

One asymmetry worth knowing before you pull `KNOWN_LOCALES`: reads fall back silently, but **writes reject**. `PATCH /api/households/me` validates `locale` against `LocaleSchema` (`src/app/api/households/me/route.ts:18`), so any client still sending `'et'` gets a 400 rather than a fallback. The settings form itself never sends it: `src/app/household/page.tsx` hands the form the resolved locale, so it shows English. The flip side is that **an owner who saves settings during a rollback rewrites the stored locale to `en`**: the form always sends its locale, and the route writes it because `'en'` differs from the stored `'et'`. That household stays English after the lever is reversed and has to pick Estonian again. Exercise this lever on staging first.

Ship either through the normal production path in [`../DEPLOYMENT.md`](../DEPLOYMENT.md) § Production Deployment Process — this is a code change, so it is a deploy, not a SQL edit.

## Matching side effects

Translation names are not display-only. `fuzzySearchIngredient` (`src/lib/ai/fuzzy-ingredient-match.ts`) searches `ingredient_translation` to resolve AI- and parser-produced Estonian ingredient names back to canonical global ingredients — that is what the `(locale, name)` index is for. It is a `pg_trgm` `similarity()` match above a threshold, not an exact one, and a global (canonical English) match always outranks a translation match.

So an edit shifts matching as well as rendering, in both directions:

- **Fixing a wrong translation improves matching.** A parsed Estonian recipe starts resolving the right word to the right global ingredient instead of coming back unmatched for the user to resolve by hand.
- **Moving a name far from what users type can lose matches.** Trigram similarity is forgiving about inflection but not about a different word — replacing a common term with a precise-but-unused one drops it below the threshold, and recipes using the common term come back unmatched instead.

Neither is a reason to avoid the edit. It is a reason to prefer the word a user would actually type over the most technically correct one, and to say so in the change-log `why` when you knowingly trade recall for accuracy.

## Adjacent work

Nothing promotes household-scoped ingredients into the global pool today: [HON-514](https://linear.app/honkadori/issue/HON-514), the admin flow that would have, was cancelled on 2026-09-15, and [`LOCALIZATION.md`](../LOCALIZATION.md#decided-principles) records when that is revisited. Whatever promotes an ingredient in future must backfill its `ingredient_translation` rows in the same step, and it is **the same person's job**: whoever curates the pool also fixes its translations.

## Reference

- Tables: `prisma/schema.prisma:355` (`IngredientTranslation`), `:407` (`MealTranslation`)
- Read path: `src/lib/i18n/content.ts` — `ingredientTranslationsInclude` / `mealTranslationsInclude`
- Locale sets: `src/lib/i18n/locales.ts` — `KNOWN_LOCALES` (`:15`), `PUBLIC_LOCALES` (`:24`)
- Ingredient matching: `src/lib/ai/fuzzy-ingredient-match.ts`
- Localization overview: [`../LOCALIZATION.md`](../LOCALIZATION.md)
- Connections, PITR, failure-mode playbooks: [`database-recovery.md`](database-recovery.md)
- Environments and the production promotion path: [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
- `DATABASE_URL_UNPOOLED`: [`../ENVIRONMENT_SETUP.md`](../ENVIRONMENT_SETUP.md) § Variable reference

## Change log

One line per **production** translation edit. Append at the bottom, newest last. No production edit has been made yet (checked 2026-10-02), so the table holds only the example row; that is the log being current, not unmaintained. Include the entity's English name alongside its id — the id alone is unreadable a month later.

The **Seed PR** column is the audit for [step 6](#6-mirror-the-edit-into-the-seed-data). Write `pending` when you log the SQL edit, and fill in the PR number when the mirror lands. A row still reading `pending` is a fix that the next production deploy will silently revert — that column is the only place anyone would notice.

| Date         | Table                      | Entity (English)                          | Locale | Before → after                  | Seed PR | Why                                                                                         |
| ------------ | -------------------------- | ----------------------------------------- | ------ | ------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| _2026-01-01_ | _`ingredient_translation`_ | _Chickpeas (`cme4x2p9k0001abcd1234wxyz`)_ | _`et`_ | _`kikerhernes` → `kikerherned`_ | _#000_  | _Example row — format reference, not a real edit. Delete once this table has real entries._ |
