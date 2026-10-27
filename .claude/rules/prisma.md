---
paths:
  - "prisma/**"
  - "src/lib/**/*.ts"
---

# Prisma rules

`import { prisma } from '@/lib/prisma'`, server-only.

**Adding models:** edit `prisma/schema.prisma` → `pnpm db:migrate` → commit schema and migration. Migration SQL uses the `@@map` table names (`"household_preferences"`, not `"HouseholdPreferences"`).
