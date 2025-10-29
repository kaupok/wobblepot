# Cyrus Proxy Worker - Deployment Guide

This guide will walk you through deploying the Cyrus proxy worker to Cloudflare Workers.

> **⚠️ SECURITY WARNING**
>
> **Never commit secrets to git.** All secrets (client IDs, client secrets, webhook secrets, encryption keys) are stored securely in Cloudflare Workers and should never be committed to the repository. The `.gitignore` file is configured to prevent accidental commits of sensitive files like `wrangler.toml` and `.dev.vars`.

## Prerequisites

- Cloudflare account (free tier works)
- Linear workspace
- Node.js and pnpm installed
- Wrangler CLI (`npm install -g wrangler`)

## Step 1: Create Cloudflare KV Namespaces

You need to create 4 KV namespaces in Cloudflare. Run these commands:

```bash
cd cyrus-proxy

# Create KV namespaces
wrangler kv:namespace create "OAUTH_TOKENS"
wrangler kv:namespace create "OAUTH_STATE"
wrangler kv:namespace create "EDGE_TOKENS"
wrangler kv:namespace create "WORKSPACE_METADATA"

# Create preview namespaces (for testing)
wrangler kv:namespace create "OAUTH_TOKENS" --preview
wrangler kv:namespace create "OAUTH_STATE" --preview
wrangler kv:namespace create "EDGE_TOKENS" --preview
wrangler kv:namespace create "WORKSPACE_METADATA" --preview
```

**Save the IDs returned by each command!** You'll need to update `wrangler.toml` with these IDs.

## Step 2: Update wrangler.toml

Edit `cyrus-proxy/wrangler.toml` and replace the KV namespace IDs with your own:

```toml
[[kv_namespaces]]
binding = "OAUTH_TOKENS"
id = "YOUR_OAUTH_TOKENS_ID"
preview_id = "YOUR_OAUTH_TOKENS_PREVIEW_ID"

[[kv_namespaces]]
binding = "OAUTH_STATE"
id = "YOUR_OAUTH_STATE_ID"
preview_id = "YOUR_OAUTH_STATE_PREVIEW_ID"

[[kv_namespaces]]
binding = "EDGE_TOKENS"
id = "YOUR_EDGE_TOKENS_ID"
preview_id = "YOUR_EDGE_TOKENS_PREVIEW_ID"

[[kv_namespaces]]
binding = "WORKSPACE_METADATA"
id = "YOUR_WORKSPACE_METADATA_ID"
preview_id = "YOUR_WORKSPACE_METADATA_PREVIEW_ID"
```

Also update the `OAUTH_REDIRECT_URI` to match your worker URL (you'll get this after deploying):

```toml
[vars]
OAUTH_REDIRECT_URI = "https://your-worker-name.your-subdomain.workers.dev/oauth/callback"
```

## Step 3: Set up Linear OAuth App

1. Go to Linear: https://linear.app/settings/api/applications/new
2. Fill in the application details:
   - **Name**: "Cyrus Bot" (or any name you prefer)
   - **Description**: "AI development agent for Linear"
   - **Callback URL**: `https://your-worker-name.your-subdomain.workers.dev/oauth/callback`
   - **Actor**: Select "Application" mode (add `actor=app` to OAuth URL)

3. Select scopes/permissions:
   - ✅ `read` - Read workspace data
   - ✅ `write` - Write to workspace
   - ✅ `app:assignable` - Allow app to be assigned to issues
   - ✅ `app:mentionable` - Allow app to be mentioned

4. Enable webhooks:
   - ✅ Enable webhooks
   - Webhook URL: `https://your-worker-name.your-subdomain.workers.dev/webhook`
   - ✅ Select "Agent session events"

5. **Save and copy:**
   - Client ID
   - Client Secret
   - Webhook Secret

## Step 4: Generate Encryption Key

Generate a random encryption key for storing OAuth tokens:

```bash
# Generate a 32-byte (256-bit) encryption key
openssl rand -hex 32
```

Save this key - you'll need it in the next step.

## Step 5: Configure Secrets

Set the secrets in Cloudflare Workers using Wrangler:

```bash
cd cyrus-proxy

# Set Linear OAuth credentials
wrangler secret put LINEAR_CLIENT_ID
# Paste your Linear Client ID and press Enter

wrangler secret put LINEAR_CLIENT_SECRET
# Paste your Linear Client Secret and press Enter

wrangler secret put LINEAR_WEBHOOK_SECRET
# Paste your Linear Webhook Secret and press Enter

# Set encryption key
wrangler secret put ENCRYPTION_KEY
# Paste your generated encryption key and press Enter
```

## Step 6: Install Dependencies

```bash
cd cyrus-proxy
pnpm install
```

## Step 7: Test Locally (Optional)

Test the worker locally before deploying:

```bash
pnpm run dev
```

This starts a local server at `http://localhost:8787`. You can test the endpoints:

- `GET /` - Dashboard
- `GET /oauth/authorize` - Start OAuth flow (will need Linear app configured)

Press Ctrl+C to stop.

## Step 8: Deploy to Cloudflare Workers

Deploy the worker to production:

```bash
pnpm run deploy
```

**Important:** Save the worker URL that's displayed after deployment! It will look like:

```
https://cyrus-proxy.your-subdomain.workers.dev
```

## Step 9: Update Linear App Callback URLs

Go back to Linear app settings and update the callback URLs with your actual worker URL:

1. Go to: https://linear.app/settings/api/applications
2. Click on your Cyrus app
3. Update:
   - **Callback URL**: `https://your-actual-worker-url.workers.dev/oauth/callback`
   - **Webhook URL**: `https://your-actual-worker-url.workers.dev/webhook`
4. Save changes

## Step 10: Set PROXY_URL Environment Variable

Add the proxy URL to your environment:

```bash
# In your shell profile (~/.zshrc or ~/.bashrc)
export PROXY_URL=https://your-actual-worker-url.workers.dev

# Or add to .env file (DO NOT COMMIT THIS FILE)
echo "PROXY_URL=https://your-actual-worker-url.workers.dev" >> ~/.cyrus/.env
```

## Step 11: Complete Cyrus Configuration

Now you can complete the Cyrus configuration:

```bash
# Restart the Cyrus setup (if still running, press Ctrl+C first)
cyrus
```

The configuration will now use your self-hosted proxy!

## Testing the Deployment

1. Visit your worker URL in a browser: `https://your-worker-url.workers.dev`
   - You should see the Cyrus Proxy Worker dashboard

2. Test OAuth flow: `https://your-worker-url.workers.dev/oauth/authorize`
   - Should redirect to Linear for authorization

3. Check logs:
   ```bash
   cd cyrus-proxy
   pnpm run tail
   ```

## Troubleshooting

**"Invalid redirect_uri"**:

- Make sure the callback URL in Linear app matches exactly: `https://your-worker-url.workers.dev/oauth/callback`
- Check that you updated `OAUTH_REDIRECT_URI` in `wrangler.toml`

**"Secret not found"**:

- Run `wrangler secret list` to verify all secrets are set
- Re-run `wrangler secret put` for any missing secrets

**"KV namespace not found"**:

- Verify KV namespace IDs in `wrangler.toml` match the ones you created
- Run `wrangler kv:namespace list` to see all your namespaces

**"Deployment failed"**:

- Check you're logged in to Cloudflare: `wrangler whoami`
- Login if needed: `wrangler login`

## Updating the Worker

To deploy updates:

```bash
cd cyrus-proxy
git pull  # If updates are available
pnpm install  # Update dependencies if needed
pnpm run deploy
```

## Monitoring

View real-time logs:

```bash
cd cyrus-proxy
pnpm run tail
```

Check Cloudflare dashboard:

1. Go to: https://dash.cloudflare.com
2. Navigate to Workers & Pages
3. Click on your `cyrus-proxy` worker
4. View metrics, logs, and analytics

## Security Notes

- Never commit secrets or API keys to git
- The `cyrus-proxy` directory is already in `.gitignore`
- Encryption key protects OAuth tokens at rest
- Linear webhook secret validates incoming webhooks
- All OAuth tokens are encrypted before storage in KV

## Cost Estimate

Cloudflare Workers Free Tier:

- 100,000 requests/day
- 10ms CPU time per request
- KV: 100,000 reads/day, 1,000 writes/day

This is more than enough for typical Cyrus usage. You'll only pay if you exceed these limits.

## Next Steps

After successful deployment:

1. Set `PROXY_URL` environment variable
2. Complete Cyrus configuration (`cyrus` command)
3. Create a test issue in Linear
4. Assign it to Cyrus bot
5. Watch it process automatically!
