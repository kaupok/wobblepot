# Fix Linting Issues

Run the linter with auto-fix enabled to resolve common code style issues.

## What This Does

This command runs ESLint with the `--fix` flag, which automatically fixes:

- Formatting issues (spacing, indentation)
- Import order problems
- Unused imports
- Simple rule violations that can be auto-corrected

## Commands to run

```bash
# Run linter with auto-fix
pnpm lint --fix

# Check if all issues were resolved
pnpm lint

# If there are remaining issues, review them manually
```

## After Running

1. Review the changes made by the auto-fixer
2. Run `git diff` to see what was modified
3. If satisfied, stage the changes: `git add -A`
4. Run `pnpm lint` again to confirm all auto-fixable issues are resolved

## Manual Fixes Required

Some linting issues cannot be auto-fixed and require manual intervention:

- Unused variables that might be needed
- Complex logic that violates rules
- TypeScript type errors flagged by ESLint

For these, review the error messages and fix them according to the project's coding standards in CLAUDE.md.

## Related Commands

- `/review-ready` - Full pre-commit checklist (includes linting)
- Run `pnpm format` - Format code with Prettier (different from linting)
