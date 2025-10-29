# Cyrus Proxy Worker

Self-hosted Cloudflare Workers proxy for Cyrus/Linear integration.

## Quick Start (New Machine Setup)

If you're setting up on a new machine:

1. **Copy configuration template:**

   ```bash
   cd cyrus-proxy
   cp wrangler.toml.example wrangler.toml
   ```

2. **Follow the deployment guide:**
   - See [QUICKSTART.md](./QUICKSTART.md) for step-by-step setup
   - Or [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed reference

## Files in This Directory

- **wrangler.toml.example** - Configuration template (committed to git)
- **wrangler.toml** - Your actual config with deployment IDs (gitignored)
- **QUICKSTART.md** - Step-by-step deployment guide
- **DEPLOYMENT.md** - Detailed reference documentation
- **src/** - Proxy worker source code
- **package.json** - Dependencies

## Important Notes

⚠️ **wrangler.toml is gitignored** because it contains deployment-specific values:

- Cloudflare KV namespace IDs
- Your worker URL
- Account-specific settings

Always use **wrangler.toml.example** as the template for new deployments.

## Useful Commands

```bash
# Install dependencies
pnpm install

# Deploy to Cloudflare
pnpm run deploy

# View real-time logs
pnpm run tail

# List secrets
wrangler secret list

# Create KV namespace
wrangler kv namespace create "NAMESPACE_NAME"
```

## Architecture

This proxy handles:

- OAuth authentication with Linear
- Webhook delivery from Linear to local Cyrus agent
- Secure token storage (encrypted in Cloudflare KV)
- Edge worker registration

For more details, see the [main Cyrus documentation](https://github.com/ceedaragents/cyrus).
