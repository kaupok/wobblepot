# Deployment Guide

Complete guide for deploying Honkadori to staging and production environments.

## Table of Contents

- [CI Pipeline](#ci-pipeline)
- [Production Deployment Process](#production-deployment-process)
  - [Deployment Flow](#deployment-flow)
  - [Why This Process?](#why-this-process)
  - [Vercel Configuration](#vercel-configuration)
  - [Rollback Procedure](#rollback-procedure)

## CI Pipeline

All changes must pass the following checks in GitHub Actions:

- `pnpm lint` - ESLint rules
- `pnpm type-check` - TypeScript type checking
- `pnpm test` - Unit tests

**Important notes:**

- Build verification happens through Vercel deployment (not in CI)
- E2E tests are currently disabled in CI but should be run locally before submitting PRs with `pnpm test:e2e`

## Production Deployment Process

Production deployments require manual coordination to ensure database migrations complete before code deployment.

### Deployment Flow

1. **Develop and merge to main**
   - Create PR with your changes
   - Merge to main after approval and CI passes
   - Staging auto-deploys and auto-migrates (via GitHub Actions)

2. **Test in staging**
   - Verify changes work correctly in staging environment
   - Test all affected functionality
   - Check for any migration issues

3. **Deploy to production** (when ready):

   **a. Run database migrations**
   - Go to: [GitHub Actions](https://github.com/kaupok/honkadori/actions/workflows/deploy-db-migrations-production.yml)
   - Click "Run workflow" button
   - Wait for completion and verify success

   **b. Deploy code**
   - Go to: [GitHub Actions](https://github.com/kaupok/honkadori/actions/workflows/deploy-code-production.yml)
   - Click "Run workflow" button
   - Wait for deployment to complete
   - Check workflow summary for deployment URL

   **c. Verify production**
   - Check production site is working
   - Monitor logs for any errors
   - Verify database changes are reflected

### Why This Process?

Production deployments from main are **disabled via Vercel's Ignored Build Step** to prevent:

- Code deploying before database migrations complete
- Schema mismatches causing runtime errors
- Production downtime from race conditions

The manual process ensures migrations always complete before code deployment.

### Vercel Configuration

**Ignored Build Step** is configured with:

```bash
if [ "$VERCEL_ENV" = "production" ]; then exit 0; else exit 1; fi
```

**Vercel Ignored Build Step logic:**

- `exit 0` → "Yes, ignore this build" → Vercel **skips** the build
- `exit 1` → "No, don't ignore this build" → Vercel **proceeds** with build

The command answers "Should I ignore this build?" (not standard shell success/failure logic).

This allows:

- ✅ Preview deployments (PRs) - Auto-deploy
- ✅ Staging environment - Auto-deploy from main
- ❌ Production environment - Manual deploy only

### Rollback Procedure

If production deployment fails:

1. **Code rollback**:
   - Vercel Dashboard → Deployments
   - Find previous working deployment
   - Click "⋯" menu → "Promote to Production"

2. **Database rollback**:
   - Database migrations may not be easily reversible
   - Contact team lead for assistance
   - May require manual SQL fixes

**Prevention**: Always test thoroughly in staging before production deployment.
