---
paths:
  - "prisma/**"
  - "src/lib/**/*.ts"
---

# Prisma rules

`import { prisma } from '@/lib/prisma'`, server-only.

**Adding models:** edit `prisma/schema.prisma` → `pnpm db:migrate` → commit schema and migration. Migration SQL uses the `@@map` table names (`"household_preferences"`, not `"HouseholdPreferences"`).

**Merging two ingredient rows:** start from the DO block in `prisma/migrations/20261101120000_merge_tomato_puree_into_passata/migration.sql`; change the `pair` array, the issue tag in its two `RAISE` messages, and the comments that name the products. Copy `prisma/merge-tomato-puree-into-passata.db.test.ts` beside it, collision case included: that case is the path a real household takes (both rows in one pantry or one meal), so it is the one a copy breaks.
