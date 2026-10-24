#!/usr/bin/env bash
# SessionStart hook: puts the .nvmrc Node first on PATH for every Bash call in
# the session, through CLAUDE_ENV_FILE. See repo-node-bin.sh for the cause.
set -uo pipefail
bin=$("$(dirname "$0")/repo-node-bin.sh")
if [ -n "$bin" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
exit 0
