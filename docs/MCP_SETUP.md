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
- **Enhanced capabilities**: File operations, database queries, sequential thinking, persistent memory
- **Reduced friction**: Pre-configured servers eliminate repetitive setup and explanation
- **Team consistency**: Shared `.mcp.json` ensures everyone has the same tools

## Configured MCP Servers

Our project uses the following MCP servers (configured in `.mcp.json`):

### 1. Filesystem Server (Official Anthropic)

- **Purpose**: Secure file operations with enhanced capabilities
- **Capabilities**: Advanced file search, directory navigation, recursive operations
- **Scope**: Project root (configured via `PROJECT_ROOT` environment variable)
- **When to use**: Complex file operations, bulk changes, deep directory exploration

### 2. GitHub Server (Official Anthropic)

- **Purpose**: Direct GitHub API integration
- **Capabilities**: Repository insights, PR management, issue tracking, workflow triggers
- **Requirements**: `GITHUB_PERSONAL_ACCESS_TOKEN` environment variable
- **When to use**: Complex GitHub operations beyond `gh` CLI capabilities

**Setup GitHub token:**

1. Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Create token with permissions: `repo`, `workflow`, `read:org`
3. Add to `.env`: `GITHUB_PERSONAL_ACCESS_TOKEN=github_pat_...`

### 3. Sequential Thinking Server (Official Anthropic)

- **Purpose**: Enhanced multi-step planning and problem decomposition
- **Capabilities**: Structured reasoning, iterative refinement, complex architecture decisions
- **When to use**: Complex features, architectural planning, debugging tricky issues
- **Note**: No API keys required

### 4. Memory Server (Official Anthropic)

- **Purpose**: Knowledge graph-based persistent memory across sessions
- **Capabilities**: Store project decisions, architecture patterns, context retention
- **When to use**: Document important decisions, track evolving patterns, maintain context
- **Note**: Memory persists across Claude Code sessions

### 5. Playwright Server (Microsoft)

- **Purpose**: Browser automation and E2E test generation/debugging
- **Capabilities**:
  - Generate tests from natural language requirements
  - Debug test failures with AI analyzing screenshots
  - Automate browser interactions for testing
  - Web scraping and interaction
- **When to use**: Writing new E2E tests, debugging test failures, automating browser tasks
- **Note**: Works with your existing Playwright setup

### 6. npm Package Search Server

- **Purpose**: npm registry search and package metadata
- **Capabilities**:
  - Search npm packages by keyword
  - Get package metadata, versions, dependencies
  - Compare package alternatives
  - Check download statistics
- **When to use**: Evaluating new dependencies, checking package versions, finding alternatives
- **Note**: Helps make informed dependency decisions

### 7. Next.js DevTools Server (Vercel)

- **Purpose**: Next.js-specific development assistance
- **Capabilities**:
  - Analyze app structure and routes
  - Get Next.js best practice recommendations
  - Identify optimization opportunities
  - Future: Automated Next.js upgrades
- **When to use**: Working on Next.js-specific features, planning upgrades, optimizing performance
- **Note**: Particularly useful for major Next.js version upgrades

### 8. Better Auth MCP (HTTP server)

- **Purpose**: Better Auth documentation search and AI chat
- **Capabilities**: Search Better Auth docs, get implementation examples
- **When to use**: Implementing auth features, troubleshooting Better Auth issues
- **Note**: Already configured globally via HTTP

### 9. Context7 (HTTP server)

- **Purpose**: General library documentation retrieval
- **Capabilities**: Up-to-date docs for any npm package or library
- **When to use**: Need API docs for third-party libraries
- **Note**: Already configured globally via HTTP

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

## Troubleshooting MCP Servers

### Server shows "Failed to connect"

1. Check server is properly installed: `npx -y @modelcontextprotocol/server-name --version`
2. Verify environment variables are set (check `.env`)
3. Restart Claude Code
4. Check server logs: `claude mcp get server-name`

### Environment variables not working

- MCP supports `${VAR}` and `${VAR:-default}` syntax in `.mcp.json`
- Variables are read from `.env` file in project root
- Restart Claude Code after changing `.env`

### GitHub server authentication

- Token must have correct scopes: `repo`, `workflow`, `read:org`
- Token must be fine-grained (not classic)
- Add to `.env`: `GITHUB_PERSONAL_ACCESS_TOKEN=github_pat_...`

## Best Practices

1. **Check server status regularly**: Run `claude mcp list` to verify all servers are connected
2. **Document decisions**: Use Memory MCP to store important architecture decisions
3. **Use Sequential Thinking for complex tasks**: Invoke it explicitly for architectural planning
4. **Leverage Better Auth MCP**: Instead of web searches, ask Better Auth MCP directly
5. **Keep environment variables secure**: Never commit `.env` file, use `.env.example` for documentation
6. **Share improvements**: If you add a useful MCP server, commit `.mcp.json` and document it here

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
