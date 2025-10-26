# Deploy to Staging

Run the staging deployment workflow and verify the deployment was successful.

## Steps

1. Check current git status and confirm we're on the main branch
2. Ensure all changes are committed and pushed
3. Trigger the staging deployment GitHub Actions workflow
4. Monitor the workflow execution
5. Once completed, verify:
   - Database migrations ran successfully
   - Build succeeded
   - Deployment is live
   - Check the staging URL works correctly

## Commands to run

```bash
# Check git status
git status

# Check current branch
git branch --show-current

# View recent workflow runs
gh run list --workflow=deploy-db-migrations-staging.yml --limit 3

# Trigger staging deployment (if manual trigger is needed)
gh workflow run deploy-db-migrations-staging.yml

# Watch the latest run
gh run watch
```

After deployment, open the Vercel staging URL and verify the application is working.
