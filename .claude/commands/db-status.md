# Check Database Migration Status

Check the current database migration status across all environments.

## Commands to run

```bash
# Check local migration status
pnpm prisma migrate status

# View recent migration workflows (staging)
gh run list --workflow=deploy-db-migrations-staging.yml --limit 5

# View recent migration workflows (production)
gh run list --workflow=deploy-db-migrations-production.yml --limit 5

# View latest staging migration details
gh run view --workflow=deploy-db-migrations-staging.yml

# View latest production migration details
gh run view --workflow=deploy-db-migrations-production.yml
```

## Useful Database Commands

```bash
# Open Prisma Studio to inspect data
pnpm db:studio

# Generate Prisma client after schema changes
pnpm db:generate

# Create a new migration (development only)
pnpm db:migrate

# Push schema changes without migration (rapid prototyping)
pnpm db:push
```

## Environment Check

Verify your local `.env` has the correct database URLs:

- `DATABASE_URL` - Connection pooling URL (Prisma Client)
- `DATABASE_URL_UNPOOLED` - Direct connection URL (migrations)

Both should be pointing to your development database (not staging/production).
