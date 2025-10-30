# Cyrus AI Agent Instructions

These instructions apply when Claude Code is running within a Cyrus worktree session, processing Linear-assigned issues.

## Linear Issue Status Management

**CRITICAL RULE: Do not update Linear issue status after a pull request has been created.**

### Context

When working on Linear issues through Cyrus:
- Linear has automation that moves issues to "In review" status when a PR is created
- Linear automation handles all subsequent status transitions (In review → Done, etc.)
- Updating the status back to "In progress" after PR creation creates conflicts with Linear's workflow

### Required Behavior

1. **Before PR creation**: You may update the Linear issue status as needed (e.g., moving from "Backlog" to "In progress")

2. **After PR creation**: Do NOT call `mcp__linear-server__update_issue` to change the issue status, even if you're:
   - Doing cleanup tasks
   - Running final tests
   - Making documentation updates
   - Performing any other follow-up work

3. **Exception**: None. Once a PR exists for an issue, Linear automation takes full control of status management.

### Allowed Actions After PR Creation

You may still:
- Create comments on the Linear issue using `mcp__linear-server__create_comment`
- Update the PR itself using `gh` commands
- Continue working on code improvements
- Run tests and validations

You just cannot change the issue's status field.

## Summary

**If a PR exists for the current issue → Never update the issue status. Linear handles it.**
