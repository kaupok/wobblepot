# Cyrus Proxy - Quick Start Guide

Follow these steps in order to deploy your self-hosted Cyrus proxy.

> **⚠️ SECURITY WARNING**
>
> **Never commit secrets to git.** All secrets (client IDs, client secrets, webhook secrets, encryption keys) are stored securely in Cloudflare Workers and should never be committed to the repository. The `.gitignore` file is configured to prevent accidental commits of sensitive files like `wrangler.toml` and `.dev.vars`.

## Prerequisites Checklist

- [x] Cloudflare account ready
- [x] Wrangler CLI installed (v4.45.1)
- [x] Proxy worker code copied to `cyrus-proxy/`
- [ ] Linear OAuth app created
- [ ] Cloudflare KV namespaces created
- [ ] Secrets configured
- [ ] Worker deployed

### Install Wrangler CLI (if needed)

If you don't have Wrangler CLI installed:

```bash
npm install -g wrangler
```

Verify installation:

```bash
wrangler --version
```

Should show version 4.x or later.

## Step-by-Step Deployment

### 1. Login to Cloudflare

```bash
cd cyrus-proxy
wrangler login
```

This opens a browser for Cloudflare authentication.

### 2. Create KV Namespaces

Run these commands and **save the IDs returned**:

```bash
# Production namespaces
wrangler kv:namespace create "OAUTH_TOKENS"
wrangler kv:namespace create "OAUTH_STATE"
wrangler kv:namespace create "EDGE_TOKENS"
wrangler kv:namespace create "WORKSPACE_METADATA"

# Preview namespaces (for testing)
wrangler kv:namespace create "OAUTH_TOKENS" --preview
wrangler kv:namespace create "OAUTH_STATE" --preview
wrangler kv:namespace create "EDGE_TOKENS" --preview
wrangler kv:namespace create "WORKSPACE_METADATA" --preview
```

### 3. Create and Update wrangler.toml

First, create your deployment configuration from the template:

```bash
cp wrangler.toml.example wrangler.toml
```

Then edit `wrangler.toml` and replace all `YOUR_*_ID_HERE` placeholders with the IDs from step 2.

**Important:** Leave the `OAUTH_REDIRECT_URI` as-is for now. We'll update it after deployment.

### 4. Install Dependencies

```bash
pnpm install
```

### 5. Initial Deployment

Deploy to get your worker URL:

```bash
pnpm run deploy
```

**Save the worker URL!** Example: `https://cyrus-proxy.your-subdomain.workers.dev`

### 6. Update OAUTH_REDIRECT_URI

Edit `wrangler.toml` and update the `OAUTH_REDIRECT_URI` with your actual worker URL:

```toml
[vars]
OAUTH_REDIRECT_URI = "https://cyrus-proxy.YOUR-ACTUAL-SUBDOMAIN.workers.dev/oauth/callback"
```

Then redeploy:

```bash
pnpm run deploy
```

### 7. Create Linear OAuth App

1. Go to: https://linear.app/settings/api/applications/new

2. Fill in:
   - **Name**: "Cyrus Bot"
   - **Description**: "AI development agent"
   - **Callback URL**: `https://cyrus-proxy.YOUR-SUBDOMAIN.workers.dev/oauth/callback`
   - **Webhook URL**: `https://cyrus-proxy.YOUR-SUBDOMAIN.workers.dev/webhook`

3. Add OAuth URL parameter: `?actor=app`
   - This enables "Application" mode instead of "User" mode

4. Select scopes:
   - [x] `read`
   - [x] `write`
   - [x] `app:assignable`
   - [x] `app:mentionable`

5. Enable webhooks:
   - [x] Enable webhooks
   - [x] Select "Agent session events"

6. **Copy and save:**
   - Client ID
   - Client Secret
   - Webhook Secret

### 8. Generate Encryption Key

```bash
openssl rand -hex 32
```

**Save this key!** You'll need it in the next step.

### 9. Configure Secrets

Set all 4 secrets:

```bash
# Linear OAuth Client ID
wrangler secret put LINEAR_CLIENT_ID
# Paste your Linear Client ID and press Enter

# Linear OAuth Client Secret
wrangler secret put LINEAR_CLIENT_SECRET
# Paste your Linear Client Secret and press Enter

# Linear Webhook Secret
wrangler secret put LINEAR_WEBHOOK_SECRET
# Paste your Linear Webhook Secret and press Enter

# Encryption Key (generated in step 8)
wrangler secret put ENCRYPTION_KEY
# Paste your encryption key and press Enter
```

### 10. Final Deployment

Deploy with all secrets configured:

```bash
pnpm run deploy
```

### 11. Test Your Proxy

Visit your worker URL in a browser:

```
https://cyrus-proxy.YOUR-SUBDOMAIN.workers.dev
```

You should see the Cyrus Proxy Worker dashboard with available endpoints.

### 12. Set PROXY_URL Environment Variable

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export PROXY_URL=https://cyrus-proxy.YOUR-ACTUAL-SUBDOMAIN.workers.dev
```

Then reload:

```bash
source ~/.zshrc  # or source ~/.bashrc
```

### 13. Complete Cyrus Configuration

Now run the Cyrus configuration:

```bash
# If still running, press Ctrl+C first to stop it
cyrus
```

When prompted, choose option 3 (self-hosted proxy). Cyrus will now use your deployed proxy!

## Verification

Test that everything works:

1. **Worker dashboard**: Visit `https://cyrus-proxy.YOUR-SUBDOMAIN.workers.dev`
2. **OAuth flow**: Visit `https://cyrus-proxy.YOUR-SUBDOMAIN.workers.dev/oauth/authorize`
3. **Check logs**: `cd cyrus-proxy && pnpm run tail`

## Troubleshooting

**"Invalid redirect_uri" error**:

- Verify callback URL in Linear app matches exactly
- Check `OAUTH_REDIRECT_URI` in `wrangler.toml`
- Redeploy after changes: `pnpm run deploy`

**"Secret not found" error**:

- List secrets: `wrangler secret list`
- Re-add missing secrets: `wrangler secret put SECRET_NAME`

**"KV namespace not found" error**:

- List namespaces: `wrangler kv:namespace list`
- Verify IDs in `wrangler.toml` match your namespace IDs

**"Not authenticated" error**:

- Check login status: `wrangler whoami`
- Login again: `wrangler login`

## Next Steps

Once deployed and configured:

1. ✅ Start Cyrus: `cyrus` or `./scripts/cyrus-start.sh`
2. ✅ Create a test issue in Linear
3. ✅ Assign it to "Cyrus" bot
4. ✅ Watch Cyrus process it automatically!

## Useful Commands

```bash
# View real-time logs
pnpm run tail

# List all secrets
wrangler secret list

# List KV namespaces
wrangler kv:namespace list

# Check authentication
wrangler whoami

# Redeploy
pnpm run deploy
```

## Cost

Cloudflare Workers Free Tier includes:

- 100,000 requests/day
- KV: 100,000 reads/day, 1,000 writes/day

More than enough for typical Cyrus usage!
