# MCP Server Setup and Configuration

Complete guide for setting up and troubleshooting Model Context Protocol (MCP) servers in the Wobblepot project.

## Table of Contents

- [What is MCP?](#what-is-mcp)
- [Configured MCP Servers](#configured-mcp-servers)
- [Verifying MCP Server Status](#verifying-mcp-server-status)
- [Adding New MCP Servers](#adding-new-mcp-servers)
- [Environment Variables](#environment-variables)
- [Troubleshooting MCP Servers](#troubleshooting-mcp-servers)
- [Best Practices](#best-practices)
- [MCP Resources](#mcp-resources)

## What is MCP?

MCP (Model Context Protocol) is an open protocol that standardizes how AI assistants connect to data sources and tools. Think of it as "USB-C for AI" - a universal standard that allows Claude Code to access specialized functionality through modular servers.

**Key benefits:**

- **Context-aware assistance**: Servers provide domain-specific knowledge (library documentation, Linear issues, PostHog data, Figma designs)
- **Enhanced capabilities**: Browser automation, Next.js analysis, product analytics
- **Reduced friction**: Pre-configured servers eliminate repetitive setup and explanation
- **Team consistency**: Shared `.mcp.json` ensures everyone has the same tools

## Configured MCP Servers

`.mcp.json` configures six servers:

- **Stdio servers**: `playwright`, `next-devtools`. Claude Code starts each with `npx`; neither needs authentication.
- **HTTP servers**: `context7`, `linear-server`, `posthog`, `figma`. They connect to remote endpoints. `context7` authenticates with the `CONTEXT7_API_KEY` header; the other three use OAuth in the browser.

### 1. Playwright Server (Microsoft)

- **Purpose**: Drive a real browser from the agent
- **Capabilities**: Navigate, click, type, fill forms, take accessibility snapshots and screenshots, read console messages and network requests
- **Authentication**: None (stdio, `npx -y @playwright/mcp`)
- **When to use**: Walking a flow by hand while writing or debugging an E2E spec, checking a change in the running app
- **Note**: Separate from the project's Playwright test runner; specs still live in `tests/e2e`

### 2. Next.js DevTools Server (Vercel)

- **Purpose**: Query a running Next.js dev server and find the docs for the installed Next.js version
- **Capabilities**:
  - `nextjs_index`: discover running dev servers and the tools each exposes at `/_next/mcp`
  - `nextjs_call`: call one of those tools (compilation and runtime errors, routes, build status)
  - `nextjs_docs`: point at the version-matched docs in `node_modules/next/dist/docs/`
  - `browser_eval`: set up the `agent-browser` CLI for browser automation
- **Authentication**: None (stdio, `npx -y next-devtools-mcp`)
- **When to use**: Diagnosing errors in a running `pnpm dev`, listing routes, reading the Next.js 16 docs before writing Next.js code

### 3. Context7 (HTTP server)

- **Purpose**: General library documentation retrieval
- **Capabilities**: Up-to-date docs for any npm package or library
- **Authentication**: Requires `CONTEXT7_API_KEY`. The `.mcp.json` entry reads it through the `${CONTEXT7_API_KEY}` header, so set it in `.claude/settings.local.json`.
- **When to use**: Need API docs for third-party libraries
- **Note**: Defined in `.mcp.json` at `https://mcp.context7.com/mcp`

**Setup Context7 API key:**

1. Go to [context7.com/dashboard](https://context7.com/dashboard) and create an API key
2. Add it to `.claude/settings.local.json` in the `env` section:
   ```json
   {
     "env": {
       "CONTEXT7_API_KEY": "your-key-here"
     }
   }
   ```
3. Restart Claude Code

### 4. Linear MCP (HTTP server)

- **Purpose**: Linear issue and project management integration
- **Capabilities**:
  - List, create, and update issues
  - Manage projects, cycles, and labels
  - Add comments to issues
  - Search Linear documentation
  - List teams, users, and issue statuses
- **Authentication**: OAuth. Claude Code prompts for sign-in on first use — the `.mcp.json` entry carries no API key.
- **When to use**: Creating issues, tracking work, updating task status, managing projects
- **Note**: Defined in `.mcp.json` at `https://mcp.linear.app/mcp`

> The automation scripts use a separate `LINEAR_API_KEY` for the Linear GraphQL API — it is for the scripts, not the MCP server. Put it in `.env` (see `.env.example`): `scripts/worktree-claude.sh` (`wt`) loads that file itself, and `wt start` passes it on to `scripts/orchestrator.sh`, which reads it from its environment. Create one at [Linear Settings → API](https://linear.app/settings/api).

**Permission presets:** All Linear MCP tools (`mcp__linear-server__*`) are pre-approved in `.claude/settings.local.json.example`, so a `settings.local.json` copied from it (see [Environment Variables](#environment-variables)) allows them.

### 5. PostHog MCP (HTTP server)

- **Purpose**: Product analytics, feature flags, error tracking, and session replay access
- **Capabilities**: Query events and insights, manage feature flags and experiments, inspect errors and logs
- **Authentication**: OAuth. Claude Code prompts for sign-in on first use.
- **When to use**: Investigating product data, managing flags, checking rollout health
- **Note**: Defined in `.mcp.json` at `https://mcp.posthog.com/mcp`

### 6. Figma MCP (HTTP server)

- **Purpose**: Read Figma designs as context for implementing UI
- **Capabilities**: Pull design context (layout, styles, variables, components) and screenshots for a frame or layer from its Figma link
- **Authentication**: OAuth. Claude Code prompts for sign-in on first use (run `/mcp` → `figma` → Authenticate).
- **When to use**: Building or changing UI from a Figma design — paste the frame's link into the prompt. Map what it returns onto our tokens and primitives per `docs/DESIGN.md`; don't copy its raw values.
- **Note**: Defined in `.mcp.json` at `https://mcp.figma.com/mcp` (Figma's remote server; no Figma desktop app needed)

## Verifying MCP Server Status

Check which servers are active and their connection status:

```bash
claude mcp list
```

**Expected output:**

- ✓ Connected - Server is working
- ✗ Failed to connect - Check configuration or API keys

## Adding New MCP Servers

### Project-wide servers (recommended for team-shared tools)

1. Edit `.mcp.json` in project root
2. Add server configuration:

```json
{
  "mcpServers": {
    "your-server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-name"],
      "env": {
        "API_KEY": "${YOUR_API_KEY}"
      }
    }
  }
}
```

3. Commit `.mcp.json` to share with team
4. Restart Claude Code

### Personal servers (local experiments)

Use local scope with Claude Code CLI:

```bash
claude mcp add --transport stdio your-server -- npx -y @modelcontextprotocol/server-name
```

### Declined servers

Serena and a Postgres MCP server were considered and declined on 2026-09-30 (HON-876); do not add either without reopening that decision.

For database work, the commands are in `CLAUDE.md` → Database Patterns, a SQL prompt is in `docs/RUNBOOKS/translation-maintenance.md` → "Getting a SQL prompt", and `pnpm prisma migrate status` and recovery are in `docs/RUNBOOKS/database-recovery.md`.

## Environment Variables

Only `CONTEXT7_API_KEY` is interpolated by `.mcp.json` (through the `${CONTEXT7_API_KEY}` header on the `context7` server). Set it in `.claude/settings.local.json`. `linear-server`, `posthog`, and `figma` authenticate through OAuth and need no key.

**Checking for drift:** `grep -o '\${[A-Z0-9_]*}' .mcp.json` lists every variable `.mcp.json` interpolates. This section should document exactly that set — if the two disagree, this doc is stale.

`LINEAR_API_KEY` is also listed here, but the Linear MCP server does not use it — it is for the automation scripts (see the note under [Linear MCP](#4-linear-mcp-http-server)). Put it in `.env` as well, which is where `scripts/worktree-claude.sh` reads it. Listing it under `env` puts it in the environment of the commands a Claude Code session runs, where `scripts/orchestrator.sh` and `scripts/neon-cleanup.sh` read it.

```json
{
  "env": {
    "CONTEXT7_API_KEY": "your-key-here",
    "LINEAR_API_KEY": "lin_api_your-key-here"
  },
  "permissions": {
    // ... your permissions
  }
}
```

**Important notes:**

- `.claude/settings.local.json` is gitignored (safe for secrets)
- `.mcp.json` references `CONTEXT7_API_KEY` with `${VAR}` syntax; the other servers use OAuth
- Don't put MCP secrets in `.env` — that file is for app environment variables and the automation scripts' keys (`LINEAR_API_KEY`, `NEON_*`), which are not MCP secrets
- Restart Claude Code after modifying `.claude/settings.local.json`

**Setup steps:**

1. Copy the example file: `cp .claude/settings.local.json.example .claude/settings.local.json`
2. Edit `.claude/settings.local.json` and replace placeholder values:
   - `CONTEXT7_API_KEY`: Context7 API key (see [Context7 setup](#3-context7-http-server))
   - `LINEAR_API_KEY`: Linear API key for the automation scripts (also add it to `.env`)
3. Restart Claude Code

**Important:** `.claude/settings.local.json` is gitignored and contains secrets. Never commit this file.

## Troubleshooting MCP Servers

### Server shows "Failed to connect"

1. Check the server's details: `claude mcp get <server-name>`
2. For a stdio server, run its command by hand to see the error: `npx -y @playwright/mcp` or `npx -y next-devtools-mcp`
3. For `context7`, verify `CONTEXT7_API_KEY` is set in `.claude/settings.local.json` (see [Context7 authentication fails](#context7-authentication-fails))
4. For `linear-server`, `posthog` or `figma`, sign in again: run `/mcp`, pick the server, and choose Authenticate
5. Restart Claude Code

### Environment variables not working

- MCP reads variables from `.claude/settings.local.json` (not `.env`)
- MCP supports `${VAR}` and `${VAR:-default}` syntax in `.mcp.json`
- Restart Claude Code after changing `.claude/settings.local.json`
- Check for typos in variable names

### Context7 authentication fails

**Symptoms:** The `context7` server shows "Failed to connect" or authentication errors.

**Common causes:**

1. **`CONTEXT7_API_KEY` not set**: The `.mcp.json` header `${CONTEXT7_API_KEY}` resolves to an empty value.
   - **Solution**: Add the key to the `env` section of `.claude/settings.local.json`, then restart Claude Code.
2. **Key in wrong location**: The key must be in `.claude/settings.local.json`, not `.env`.
   - Check the `env` section exists and the variable name is exactly `CONTEXT7_API_KEY`.

## Best Practices

1. **Check server status regularly**: Run `claude mcp list` to verify all servers are connected
2. **Prefer Context7 to web search for library docs**, and `nextjs_docs` for Next.js, so answers match the installed versions
3. **Keep environment variables secure**: Never commit `.env` file, use `.env.example` for documentation
4. **Share improvements**: If you add a useful MCP server, commit `.mcp.json` and document it here

## MCP Resources

- **Official documentation**: [modelcontextprotocol.io](https://modelcontextprotocol.io)
- **Server repository**: [github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- **Claude Code MCP docs**: [docs.claude.com/en/docs/claude-code/mcp](https://docs.claude.com/en/docs/claude-code/mcp)
- **MCP server directory**: [mcpserverfinder.com](https://www.mcpserverfinder.com)
