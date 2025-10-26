# Deploy to Production

**CRITICAL**: Production deployments require manual coordination to ensure database migrations complete before code deployment.

## Pre-Deployment Checklist

1. ✓ All changes merged to main
2. ✓ Staging deployment tested and verified
3. ✓ No active incidents or issues
4. ✓ Team notified (if applicable)
5. ✓ Database backup verified (Neon automatic backups)

## Deployment Process

### Step 1: Run Database Migrations

```bash
# Trigger the production database migration workflow
gh workflow run deploy-db-migrations-production.yml

# Monitor the migration
gh run watch --workflow=deploy-db-migrations-production.yml

# Verify migration succeeded
gh run view --workflow=deploy-db-migrations-production.yml
```

**Wait for migrations to complete successfully before proceeding!**

### Step 2: Deploy Code

```bash
# Trigger the production code deployment workflow
gh workflow run deploy-code-production.yml

# Monitor the deployment
gh run watch --workflow=deploy-code-production.yml

# Get deployment URL
gh run view --workflow=deploy-code-production.yml
```

### Step 3: Verify Production

1. Open production URL
2. Test critical paths:
   - Authentication (sign in/sign up/sign out)
   - Protected routes
   - API endpoints
3. Check error logs (if applicable)
4. Monitor for any issues

## Rollback Procedure

If deployment fails:

1. **Code rollback**: Vercel Dashboard → Deployments → Promote previous working deployment
2. **Database rollback**: Contact team lead (migrations may not be easily reversible)

## Why This Process?

Production deployments from main are disabled via Vercel's Ignored Build Step to prevent:

- Code deploying before database migrations complete
- Schema mismatches causing runtime errors
- Production downtime from race conditions

The manual process ensures migrations always complete before code deployment.
