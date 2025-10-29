# Cyrus/Linear Integration Guide

Complete guide for setting up and using Cyrus, an autonomous AI development agent that integrates with Linear issue tracking and Claude Code.

## Table of Contents

- [What is Cyrus](#what-is-cyrus)
- [Initial Setup](#initial-setup)
  - [Step 1: Install Cyrus CLI](#step-1-install-cyrus-cli)
  - [Step 2: Deploy Self-Hosted Proxy](#step-2-deploy-self-hosted-proxy)
  - [Step 3: Configure Cyrus](#step-3-configure-cyrus)
- [Configuration](#configuration)
- [Usage Workflow](#usage-workflow)
- [Monitoring and Troubleshooting](#monitoring-and-troubleshooting)

## What is Cyrus

**Cyrus** is an autonomous AI development agent that integrates with Linear issue tracking and Claude Code. It monitors Linear issues assigned to it, automatically creates isolated Git worktrees for each task, executes Claude Code sessions to process them, and posts results back to Linear as comments—all running locally on your machine.

Cyrus enables fully automated issue processing:

- **Autonomous workflow**: Detects Linear issues assigned to Cyrus bot, creates worktrees, and processes them without manual intervention
- **Isolated environments**: Each issue gets its own Git worktree, preventing conflicts between concurrent tasks
- **AI-powered development**: Uses Claude Code to understand requirements, make changes, and solve problems
- **Linear integration**: Posts progress updates and results as Linear comments, creates PRs if needed
- **Security controls**: Granular tool permissions control what Cyrus can do (read-only, safe mode, full access)

**Current configuration**: Safe mode (can read/edit files, run git/gh/pnpm commands, but no arbitrary bash/shell execution)

## Initial Setup

Setting up Cyrus on a new machine requires three steps:

### Step 1: Install Cyrus CLI

```bash
npm install -g cyrus-ai
```

Verify installation:

```bash
cyrus --version  # Should show 0.1.57 or later
```

### Step 2: Deploy Self-Hosted Proxy

The proxy handles OAuth with Linear and webhooks. Follow the detailed guide in `cyrus-proxy/`:

```bash
cd cyrus-proxy
cp wrangler.toml.example wrangler.toml
# Then follow cyrus-proxy/QUICKSTART.md for complete deployment steps
```

**Quick summary of proxy deployment:**

1. Install Wrangler CLI: `npm install -g wrangler`
2. Login to Cloudflare: `wrangler login`
3. Create KV namespaces
4. Update `wrangler.toml` with namespace IDs
5. Deploy: `pnpm run deploy`
6. Create Linear OAuth app with callback URLs
7. Configure secrets: `wrangler secret put`
8. Set `PROXY_URL` environment variable

See [cyrus-proxy/QUICKSTART.md](../cyrus-proxy/QUICKSTART.md) for step-by-step instructions.

### Step 3: Configure Cyrus

Once the proxy is deployed and `PROXY_URL` is set, run:

```bash
cyrus
```

This will:

1. **Connect Linear via OAuth** - Opens browser for Linear authentication
2. **Configure repository** - Prompts for repository path and settings
3. **Set tool permissions** - Choose security level (use "safe" mode)
4. **Save configuration** - Creates `~/.cyrus/config.json`

**Recommended configuration:**

When prompted, use these settings:

- **Repository path**: `/path/to/honkadori` (use your actual project path)
- **Allowed tools**: Custom (read/edit files + git/gh/pnpm commands, no arbitrary bash)
- **MCP config**: `.mcp.json` (uses project's existing MCP setup)

**What happens during setup:**

The configuration wizard will:

- Ask for Linear OAuth authorization (opens browser)
- Prompt for repository details
- Ask about tool permissions (choose "safe" initially, then manually add `Bash(pnpm:*)` to config)
- Optionally configure MCP servers (point to `.mcp.json`)
- Create `~/.cyrus/config.json` with your settings

## Configuration

### Configuration file location

`~/.cyrus/config.json`

### Repository setup script

`.claude/cyrus-setup.sh`

This script runs automatically when Cyrus creates a new worktree. It:

- Installs dependencies with `pnpm install`
- Generates Prisma client
- Runs health check to verify environment
- Prepares worktree for development

**Available environment variables in setup script:**

- `LINEAR_ISSUE_IDENTIFIER` - Issue ID (e.g., "HON-123")
- `LINEAR_ISSUE_TITLE` - Issue title
- `CYRUS_REPO_PATH` - Path to the worktree

### Security configuration

Current permissions allow Cyrus to:

- ✅ Read all project files
- ✅ Edit and write files
- ✅ Run git commands (checkout, commit, push, branch)
- ✅ Run gh commands (GitHub CLI)
- ✅ Run pnpm commands (install, test, build, db:generate, etc.)
- ✅ Use TodoWrite for task tracking
- ✅ Access MCP servers (Better Auth docs, Context7, etc.)
- ❌ Execute arbitrary bash/shell commands
- ❌ Run system-level commands (rm -rf, etc.)

This allows Cyrus to autonomously set up and develop features while preventing potentially dangerous system operations.

**Allowed tools in config:**

```json
"allowedTools": [
  "Read(**)",
  "Edit(**)",
  "Bash(git:*)",
  "Bash(gh:*)",
  "Bash(pnpm:*)",
  "Task",
  "WebFetch",
  "WebSearch",
  "TodoRead",
  "TodoWrite",
  "NotebookRead",
  "NotebookEdit",
  "Batch"
]
```

### Editing configuration

```bash
# View current config
cat ~/.cyrus/config.json

# Edit config
vi ~/.cyrus/config.json

# Or edit repository setup script
vi .claude/cyrus-setup.sh
```

## Usage Workflow

### Starting Cyrus

```bash
# Using convenience script (recommended)
./scripts/cyrus-start.sh

# Or directly
cyrus
```

Cyrus will run continuously, monitoring Linear for assigned issues.

### Assigning issues to Cyrus

1. Create or open an issue in Linear
2. Click the assignee field
3. Select "Cyrus" bot from the dropdown
4. Cyrus automatically detects the assignment and begins processing

### What Cyrus does

1. **Detects assignment** - Monitors Linear for issues assigned to Cyrus bot
2. **Creates worktree** - Runs `git worktree add` for isolated development
3. **Runs setup** - Executes `.claude/cyrus-setup.sh` to prepare environment (installs dependencies, generates Prisma client)
4. **Processes issue** - Uses Claude Code to understand and implement changes
5. **Posts results** - Comments on Linear issue with progress and results
6. **Creates PR** - Optionally creates pull request (if `gh` CLI is available)

### Checking status

```bash
# Check Cyrus status and active worktrees
./scripts/cyrus-status.sh

# List all worktrees manually
git worktree list
```

### Cleaning up worktrees

Cyrus typically cleans up after itself, but you can manually remove worktrees:

```bash
# Remove a specific worktree
git worktree remove <path>

# Remove all worktrees
git worktree prune
```

## Monitoring and Troubleshooting

### Monitoring Cyrus

- Watch terminal output where Cyrus is running
- Check Linear issue comments for progress updates
- Use `./scripts/cyrus-status.sh` to see active worktrees
- Monitor git worktrees: `git worktree list`

### Common issues

**"Configuration not found"**:

- Run `cyrus` to complete initial setup
- Verify `~/.cyrus/config.json` exists

**"Linear authentication failed"**:

- Re-run `cyrus` to refresh OAuth token
- Check Linear workspace permissions

**"Worktree creation failed"**:

- Ensure main branch is clean: `git status`
- Check disk space: `df -h`
- Remove stale worktrees: `git worktree prune`

**"Setup script failed"**:

- Check `.claude/cyrus-setup.sh` for errors
- Verify environment variables are set
- Run health check manually: `./scripts/health-check.sh`

**"Claude Code session failed"**:

- Check MCP servers are running: `claude mcp list`
- Verify allowed tools configuration in `~/.cyrus/config.json`
- Check Claude Code authentication: `claude auth status`

### Useful commands

```bash
# Start Cyrus
./scripts/cyrus-start.sh

# Check status
./scripts/cyrus-status.sh

# View config
cat ~/.cyrus/config.json

# List worktrees
git worktree list

# Remove worktree
git worktree remove <path>

# View Cyrus logs (terminal where Cyrus is running)
# Press Ctrl+C to stop Cyrus
```

### Future enhancements

When ready to run Cyrus 24/7:

1. Deploy to VPS or cloud server
2. Set up webhooks for Linear events
3. Configure reverse proxy (nginx) or ngrok
4. Update configuration for server environment

**Label-based routing** (optional future enhancement):

- Route "bug" labeled issues to debugger mode
- Route "feature" labeled issues to builder mode
- Route "scope" labeled issues to scoping mode
- Configure via `labelPrompts` in `~/.cyrus/config.json`

### Resources

- **Cyrus repository**: [github.com/ceedaragents/cyrus](https://github.com/ceedaragents/cyrus)
- **Linear API docs**: [developers.linear.app](https://developers.linear.app)
- **Claude Code docs**: [docs.claude.com/claude-code](https://docs.claude.com/claude-code)
