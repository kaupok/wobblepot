# MCP Server Setup and Configuration

Complete guide for setting up and troubleshooting Model Context Protocol (MCP) servers in the Honkadori project.

## Table of Contents

- [What is MCP?](#what-is-mcp)
- [Configured MCP Servers](#configured-mcp-servers)
- [Verifying MCP Server Status](#verifying-mcp-server-status)
- [Adding New MCP Servers](#adding-new-mcp-servers)
- [Troubleshooting MCP Servers](#troubleshooting-mcp-servers)
- [Best Practices](#best-practices)
- [Database Operations (Without Postgres MCP)](#database-operations-without-postgres-mcp)
- [Future MCP Enhancements](#future-mcp-enhancements)
- [MCP Resources](#mcp-resources)

## What is MCP?

MCP (Model Context Protocol) is an open protocol that standardizes how AI assistants connect to data sources and tools. Think of it as "USB-C for AI" - a universal standard that allows Claude Code to access specialized functionality through modular servers.

**Key benefits:**

- **Context-aware assistance**: Servers provide domain-specific knowledge (Better Auth docs, library documentation)
- **Enhanced capabilities**: Browser automation, package search, Next.js analysis, product analytics
- **Reduced friction**: Pre-configured servers eliminate repetitive setup and explanation
- **Team consistency**: Shared `.mcp.json` ensures everyone has the same tools

## Configured MCP Servers

Our project uses the following MCP servers:

**Configuration locations:**

- **Stdio servers** (in `.mcp.json`): playwright, npm-package-search, next-devtools
- **HTTP servers** (in `.mcp.json`): context7, linear-server, posthog
- **HTTP servers** (configured globally): better-auth

> **Note**: The `better-auth` server is configured globally via Claude Code and does not appear in the project's `.mcp.json` file. The `context7`, `linear-server`, and `posthog` HTTP servers are in `.mcp.json`. HTTP servers connect to remote endpoints and authenticate with an API key or OAuth.

### 1. Playwright Server (Microsoft)

- **Purpose**: Browser automation and E2E test generation/debugging
- **Capabilities**:
  - Generate tests from natural language requirements
  - Debug test failures with AI analyzing screenshots
  - Automate browser interactions for testing
  - Web scraping and interaction
- **When to use**: Writing new E2E tests, debugging test failures, automating browser tasks
- **Note**: Works with your existing Playwright setup

### 2. npm Package Search Server

- **Purpose**: npm registry search and package metadata
- **Capabilities**:
  - Search npm packages by keyword
  - Get package metadata, versions, dependencies
  - Compare package alternatives
  - Check download statistics
- **When to use**: Evaluating new dependencies, checking package versions, finding alternatives
- **Note**: Helps make informed dependency decisions

### 3. Next.js DevTools Server (Vercel)

- **Purpose**: Next.js-specific development assistance
- **Capabilities**:
  - Analyze app structure and routes
  - Get Next.js best practice recommendations
  - Identify optimization opportunities
  - Future: Automated Next.js upgrades
- **When to use**: Working on Next.js-specific features, planning upgrades, optimizing performance
- **Note**: Particularly useful for major Next.js version upgrades

### 4. Context7 (HTTP server)

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

### 5. Linear MCP (HTTP server)

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

> The automation scripts use a separate `LINEAR_API_KEY` for the Linear GraphQL API — it is for the scripts, not the MCP server. `scripts/worktree-claude.sh` sources it from `.env` (see `.env.example`); `scripts/orchestrator.sh` reads it from its environment, so export it in your shell or keep it in the `env` block of `.claude/settings.local.json` when launching from a Claude Code session. Create one at [Linear Settings → API](https://linear.app/settings/api).

**Permission presets:** All Linear MCP tools (`mcp__linear-server__*`) are pre-approved in `.claude/settings.local.json`

### 6. PostHog MCP (HTTP server)

- **Purpose**: Product analytics, feature flags, error tracking, and session replay access
- **Capabilities**: Query events and insights, manage feature flags and experiments, inspect errors and logs
- **Authentication**: OAuth. Claude Code prompts for sign-in on first use.
- **When to use**: Investigating product data, managing flags, checking rollout health
- **Note**: Defined in `.mcp.json` at `https://mcp.posthog.com/mcp`

### 7. Better Auth MCP (HTTP server)

- **Purpose**: Better Auth documentation search and AI chat
- **Capabilities**: Search Better Auth docs, get implementation examples
- **When to use**: Implementing auth features, troubleshooting Better Auth issues
- **Note**: Configured globally via Claude Code, so it does not appear in `.mcp.json`

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

## Environment Variables

Only `CONTEXT7_API_KEY` is interpolated by `.mcp.json` (through the `${CONTEXT7_API_KEY}` header on the `context7` server). Set it in `.claude/settings.local.json`. `linear-server` and `posthog` authenticate through OAuth and need no key.

**Checking for drift:** `grep -o '\${[A-Z0-9_]*}' .mcp.json` lists every variable `.mcp.json` interpolates. This section should document exactly that set — if the two disagree, this doc is stale.

`LINEAR_API_KEY` is also listed here, but the Linear MCP server does not use it — it is for the automation scripts (see the note under [Linear MCP](#5-linear-mcp-http-server)). Put it in `.env` as well, which is where `scripts/worktree-claude.sh` reads it.

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
   - `CONTEXT7_API_KEY`: Context7 API key (see [Context7 setup](#4-context7-http-server))
   - `LINEAR_API_KEY`: Linear API key for the automation scripts (also add it to `.env`)
3. Restart Claude Code

**Important:** `.claude/settings.local.json` is gitignored and contains secrets. Never commit this file.

## Troubleshooting MCP Servers

### Server shows "Failed to connect"

1. Check server is properly installed: `npx -y @modelcontextprotocol/server-name --version`
2. Verify environment variables are set in `.claude/settings.local.json`
3. Restart Claude Code
4. Check server logs: `claude mcp get server-name`

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
2. **Leverage Better Auth MCP**: Instead of web searches, ask Better Auth MCP directly
3. **Keep environment variables secure**: Never commit `.env` file, use `.env.example` for documentation
4. **Share improvements**: If you add a useful MCP server, commit `.mcp.json` and document it here

## Database Operations (Without Postgres MCP)

We intentionally exclude the Postgres MCP server because our existing tools provide better workflows:

### For data inspection and editing

```bash
pnpm db:studio  # Opens Prisma Studio GUI
```

- Visual interface with relationships
- Type-safe edits
- No SQL required

### For raw SQL queries

- **Option 1**: Neon Dashboard → SQL Editor (https://console.neon.tech)
- **Option 2**: Prisma raw queries in code:
  ```typescript
  await prisma.$queryRaw`SELECT ...`
  await prisma.$executeRaw`UPDATE ...`
  ```

### For schema operations

```bash
pnpm db:migrate        # Create new migration
pnpm db:migrate status # Check migration status
pnpm db:push          # Push schema without migration (dev only)
pnpm db:generate      # Regenerate Prisma Client
```

### When to reconsider Postgres MCP

- Complex analytical queries requiring EXPLAIN ANALYZE
- Database grows to 20+ tables with complex relationships
- Frequent database administration tasks
- Performance optimization beyond Prisma's capabilities

## Future MCP Enhancements

Potential additions to consider:

### When Codebase Grows Larger

- **Serena MCP** ([github.com/oraios/serena](https://github.com/oraios/serena)): Semantic code analysis via Language Server Protocol
  - **When to add**: Codebase grows to 100+ files or 10K+ lines
  - **Current status**: 35 files, ~3K lines (too small to benefit)
  - **Benefits**: Symbol-level code navigation, precise editing, reduced token usage
  - **Tools provided**: `find_symbol`, `find_referencing_symbols`, `insert_after_symbol`
  - **Requirements**: Install `uv` tool (`brew install uv` or `pip3 install uv`)
  - **Installation**: `claude mcp add serena -- uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context ide-assistant --project "$(pwd)"`
  - **Note**: Works best for large codebases with complex cross-file dependencies; minimal benefit for small projects

**Monitor codebase growth:**

```bash
# Check current file count
find src -type f \( -name "*.ts" -o -name "*.tsx" \) | wc -l
# When this hits ~100+, consider adding Serena
```

### Other Tools

- **Sentry MCP**: Error monitoring and log querying (if we add Sentry)
- **Puppeteer MCP**: Automated browser testing and screenshots
- **Slack MCP**: Deployment notifications (if we use Slack)
- **Custom MCP server**: Project-specific tools (component generator, etc.)

When adding new servers, update this documentation and commit `.mcp.json` to share with the team.

## MCP Resources

- **Official documentation**: [modelcontextprotocol.io](https://modelcontextprotocol.io)
- **Server repository**: [github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)
- **Claude Code MCP docs**: [docs.claude.com/en/docs/claude-code/mcp](https://docs.claude.com/en/docs/claude-code/mcp)
- **MCP server directory**: [mcpserverfinder.com](https://www.mcpserverfinder.com)
