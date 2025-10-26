# Check Dependencies

Check for outdated packages and security vulnerabilities in project dependencies.

## What This Does

Runs multiple checks to assess the health of your dependencies:

- Lists outdated packages and their available updates
- Checks for known security vulnerabilities
- Shows why specific packages are installed (dependency tree)

## Commands to run

```bash
# Check for outdated dependencies
pnpm outdated

# Check for security vulnerabilities
pnpm audit

# For more detailed vulnerability info
pnpm audit --json

# Check why a specific package is installed
# pnpm why <package-name>
```

## Understanding the Output

### pnpm outdated

Shows three versions for each package:

- **Current**: Version installed in your project
- **Wanted**: Latest version that satisfies package.json semver range
- **Latest**: Latest version available on npm registry

**Color coding:**

- Red: Major version updates (breaking changes possible)
- Yellow: Minor/patch updates (safer to update)

### pnpm audit

Security vulnerability severity levels:

- **Critical**: Fix immediately
- **High**: Fix soon
- **Moderate**: Review and plan fix
- **Low**: Consider fixing when convenient

## Updating Dependencies

**Safe update (respects semver in package.json):**

```bash
pnpm update
```

**Update specific package:**

```bash
pnpm update <package-name>
```

**Update to latest (ignores semver range):**

```bash
pnpm update <package-name> --latest
```

**Update all to latest (use with caution):**

```bash
pnpm update --latest
```

## After Updating

Always run the full test suite after updating dependencies:

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm test:e2e
```

## Security Vulnerability Fixes

If vulnerabilities are found:

1. Review the vulnerability details
2. Check if there's a patch available: `pnpm audit --fix`
3. If no automated fix, manually update the vulnerable package
4. Test thoroughly after updating

## Related Commands

- `/review-ready` - Pre-commit checklist
- Check package docs with Context7 MCP before updating major versions
