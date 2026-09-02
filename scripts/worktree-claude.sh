#!/bin/bash
# Parallel Claude Code Worktree Manager
#
# Manages git worktrees for running multiple Claude Code instances in parallel.
# Each worktree is isolated, allowing concurrent work on different features.
#
# Usage:
#   ./scripts/worktree-claude.sh new <branch-name>      # Create new worktree + start Claude
#   ./scripts/worktree-claude.sh auto [issue-id|branch] # Create worktree + run /auto-implement autonomously
#   ./scripts/worktree-claude.sh resume <branch-name>   # Resume existing worktree
#   ./scripts/worktree-claude.sh list                   # List all worktrees
#   ./scripts/worktree-claude.sh status                 # Show orchestrator and worker status
#   ./scripts/worktree-claude.sh sync <branch-name>     # Sync permissions to main repo
#   ./scripts/worktree-claude.sh sync-all               # Sync permissions from all worktrees
#   ./scripts/worktree-claude.sh cleanup <branch-name>  # Remove worktree (auto-syncs)
#   ./scripts/worktree-claude.sh cleanup-all            # Remove all parallel worktrees (auto-syncs)
#
# Worktrees are created in ~/.worktrees/wobblepot/<branch-name>

set -e

# Configuration
REPO_NAME="wobblepot"
WORKTREE_BASE="$HOME/.worktrees/$REPO_NAME"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Untracked files to copy to worktrees, relative to repo root.
UNTRACKED_FILES=(
  ".env"
  ".claude/settings.local.json"
)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Get the main (non-worktree) repository path
get_main_repo_path() {
  # The main worktree is the first line in git worktree list (not in WORKTREE_BASE)
  git worktree list | head -1 | awk '{print $1}'
}

# Sync permissions from worktree back to main repo
sync_permissions() {
  local worktree_path="$1"
  local worktree_settings="$worktree_path/.claude/settings.local.json"
  local main_repo_path=$(get_main_repo_path)
  local main_settings="$main_repo_path/.claude/settings.local.json"

  # Skip if syncing main repo to itself
  if [ "$worktree_path" = "$main_repo_path" ]; then
    return 0
  fi

  # Skip if either file doesn't exist
  if [ ! -f "$worktree_settings" ] || [ ! -f "$main_settings" ]; then
    return 0
  fi

  # Check for jq
  if ! command -v jq &> /dev/null; then
    echo -e "${YELLOW}Warning: jq not found, skipping permission sync${NC}"
    return 0
  fi

  # Get permissions from both files
  local worktree_perms=$(jq -r '.permissions.allow // []' "$worktree_settings" 2>/dev/null)
  local main_perms=$(jq -r '.permissions.allow // []' "$main_settings" 2>/dev/null)

  # Find new permissions (in worktree but not in main)
  local new_perms=$(jq -n --argjson wt "$worktree_perms" --argjson main "$main_perms" \
    '$wt - $main')

  local new_count=$(echo "$new_perms" | jq 'length')

  if [ "$new_count" -gt 0 ]; then
    echo -e "${BLUE}Syncing $new_count new permission(s) to main repo...${NC}"
    echo "$new_perms" | jq -r '.[]' | while read -r perm; do
      echo "  + $perm"
    done

    # Merge new permissions into main settings. Write to a unique temp file in
    # the target directory (mktemp), not a fixed `.tmp` name: two workers that
    # finish at the same time must not share one temp path, or one jq truncates
    # the other and the surviving mv installs corrupt JSON. The temp sits beside
    # the target, so the mv is an atomic same-filesystem rename.
    local tmp
    tmp=$(mktemp "${main_settings}.XXXXXX")
    if jq --argjson new "$new_perms" '.permissions.allow += $new | .permissions.allow |= unique' \
      "$main_settings" > "$tmp"; then
      mv "$tmp" "$main_settings"
    else
      rm -f "$tmp"
    fi

    echo -e "${GREEN}Permissions synced to $main_settings${NC}"
  fi
}

# ─── Neon database branching ──────────────────────────────────────────────────
#
# Each worktree can be paired with its own Neon branch (isolated copy-on-write
# database). Opt-in via NEON_API_KEY + NEON_PROJECT_ID env vars. When unset,
# worktrees fall back to the shared DATABASE_URL from .env.
#
# neonctl is invoked via pnpm dlx with a pinned version — no dev dep, no
# global install, reproducible behavior. Bump NEONCTL_VERSION deliberately.
NEONCTL_VERSION="2.22.0"

# Map a git branch name to a Neon branch name (deterministic, reversible).
# `/` becomes `--` rather than `-` so git branches `feat/foo-bar` and
# `feat-foo/bar` don't collide on the same Neon branch name.
# Example: auto/hon-339-foo -> auto--hon-339-foo
neon_branch_name() {
  echo "${1//\//--}"
}

# Hard-refuse list of protected Neon branch names. Defense-in-depth against
# catastrophic deletes (see Neon dashboard's ⛨ marker for server-side backstop).
is_protected_neon_branch() {
  case "$1" in
    staging|main|production|preview) return 0 ;;
    *) return 1 ;;
  esac
}

# Check if Neon integration is configured.
neon_enabled() {
  [ -n "${NEON_API_KEY:-}" ] && [ -n "${NEON_PROJECT_ID:-}" ]
}

# Atomically update (or create) a key in a .env file. Values are double-quoted
# to match .env.example convention. Regex anchors on `^KEY=` so related keys
# (e.g., DATABASE_URL vs DATABASE_URL_UNPOOLED) aren't cross-matched.
update_env_var() {
  local key="$1" value="$2" file="$3"
  local tmp
  tmp=$(mktemp)
  awk -v k="$key" -v v="$value" '
    BEGIN { found = 0 }
    $0 ~ "^"k"=" { print k"=\""v"\""; found = 1; next }
    { print }
    END { if (!found) print k"=\""v"\"" }
  ' "$file" > "$tmp" && mv "$tmp" "$file"
}

# Neon branch names an automated reaper is allowed to consider: `<prefix>--hon-<N>`
# with an optional slug tail. Kept in sync with scripts/neon-cleanup.sh's
# SAFE_BRANCH_REGEX — the two reapers must agree on what "an orchestrator branch"
# looks like (HON-572). `--` is neon_branch_name's mapping of the git `/`, so this
# covers both `auto/hon-51` (no-branchName fallback) and Linear's real branch
# names like `kaupokorv/hon-51-slug`, which is what spawn_worker actually uses.
NEON_ISSUE_BRANCH_REGEX='^[A-Za-z0-9._-]+--hon-[0-9]+(-[A-Za-z0-9._-]+)?$'

# Pure selection half of neon_gc_orphans: given the `neonctl branches list` JSON
# and the newline-separated list of live worktree branch names (already mapped
# through neon_branch_name), print the Neon branches that should be deleted.
# Split out so scripts/orchestrator.test.ts can exercise the real jq expression
# and the real protection/worktree filters without touching neonctl.
neon_gc_orphan_names() {
  local list_out="$1" live_worktrees="$2"

  # GC reclaims branches the tooling created: `auto-` (the orchestrator's
  # `wt auto HON-XX` → `auto/hon-XX` → Neon `auto--hon-XX` fallback), any
  # `<prefix>--hon-<N>[-slug]` (the Linear branch names spawn_worker normally
  # uses — these had NO reaper at all before HON-572), plus
  # `${NEON_USER_PREFIX}-` when set (interactive `wt new <prefix>/...`).
  # Anything else — `feat-`, `fix-`, test scaffolds, hand-managed branches —
  # stays untouched; users clean those up via `wt cleanup`.
  # Shape-tolerant: accepts either `[...]` or `{"branches": [...]}` wire formats.
  # `.branches // .` would throw on a bare array (Cannot index array with string),
  # so dispatch on type first.
  local all_neon_branches
  all_neon_branches=$(echo "$list_out" \
    | jq -r --arg user_prefix "${NEON_USER_PREFIX:-}" \
           --arg issue_re "$NEON_ISSUE_BRANCH_REGEX" '
        if type == "array" then .[]
        elif .branches then .branches[]
        else empty end
        | select(
            (.name | startswith("auto-"))
            or (.name | test($issue_re))
            or ($user_prefix != "" and (.name | startswith($user_prefix + "-")))
          )
        | .name')

  local b
  while IFS= read -r b; do
    [ -z "$b" ] && continue
    # A live worktree still points at this branch — it is in use, not an orphan.
    echo "$live_worktrees" | grep -qxF "$b" && continue
    is_protected_neon_branch "$b" && continue
    echo "$b"
  done <<< "$all_neon_branches"
}

# Delete Neon branches whose live git worktree no longer exists. Filters to the
# prefixes/shapes neon_gc_orphan_names recognises so the GC can't touch
# hand-managed branches. Skips protected names. Safe to call repeatedly; errors
# from individual deletes are ignored (best-effort sweep).
neon_gc_orphans() {
  neon_enabled || return 0
  local live_worktrees
  # Must match neon_branch_name's `/` -> `--` mapping so GC can recognize its
  # own branches. Never bump this in isolation.
  live_worktrees=$(git -C "$REPO_ROOT" worktree list --porcelain \
    | awk '/^branch /{print substr($2, 12)}' | sed 's|/|--|g' | sort -u)

  # Split list + filter into two steps so we can detect API failures. A silent
  # no-op here would mask the real problem (auth, network, rate limit) as a
  # later "cap exceeded" error, which is much harder to diagnose.
  local list_out list_rc
  list_out=$(pnpm dlx "neonctl@$NEONCTL_VERSION" branches list \
    --project-id "$NEON_PROJECT_ID" --output json 2>/dev/null)
  list_rc=$?
  if [ "$list_rc" -ne 0 ]; then
    echo -e "${YELLOW}Warning: Neon branches list failed (exit $list_rc) — skipping orphan GC${NC}" >&2
    return 0
  fi

  local b
  while IFS= read -r b; do
    [ -z "$b" ] && continue
    pnpm dlx "neonctl@$NEONCTL_VERSION" branches delete "$b" \
      --project-id "$NEON_PROJECT_ID" >/dev/null 2>&1 || true
  done <<< "$(neon_gc_orphan_names "$list_out" "$live_worktrees")"
}

# Classify a failed `neonctl branches create` from its error text alone.
# Prints exactly one of: exists | cap | unknown.
#
# The branch name is removed from the input before anything is matched. neonctl
# echoes it back (`branch_name:"…"`), and the exhaustion test below is substring
# matching, so a branch whose slug contains `cap`, `limit`, `quota`, `exceed` or
# `maximum` would otherwise read as branch exhaustion. That is HON-581:
# `kaupo--hon-580-…-silent-queue-cap-dead-code-stale` turned a plain "already
# exists" into a reported capacity problem, and the orchestrator RETRY that
# needed the reuse path lost it. Two removals, because they fail differently:
# the `sed` handles the field even when the name we asked for is not what came
# back, and the literal `${text//…}` handles the name appearing in any other
# shape. Quoting the expansion keeps it a fixed-string replace — `${text//$b/}`
# would read `$b` as a glob. `git check-ref-format` rejects the metacharacters
# that would bite (`*`, `?`, `[`), so this is defensive rather than load-bearing.
#
# Order matters more than either. `already exists` / `duplicate` is an
# unambiguous signal from the API, so it is tested first; the exhaustion
# keywords are a guess at wording Neon does not document, and only get what is
# left.
#
# The cap test requires "branch" and a keyword on the SAME LINE, which is the
# proximity the old `grep -qi "branch"` conjunct claimed and never delivered —
# it was a second independent grep over the whole output. Proximity is not
# cosmetic here: `cap` classifies on bare substrings, so `Rate limit exceeded`,
# `insufficient capacity`, even `invalid escape sequence` (es-CAP-e) would
# otherwise call neon_gc_orphans. That sweep deletes every Neon branch with no
# live worktree, project-wide — and handle_failure's RETRY leaves exactly that
# shape behind (`cleanup_worker_worktree "$branch" true` removes the worktree
# and keeps the branch). One worker's rate-limit response must not be able to
# destroy another worker's preserved retry database.
neon_classify_create_error() {
  local text="$1" neon_branch="${2:-}"
  text=$(printf '%s' "$text" | sed 's/branch_name:[[:space:]]*"[^"]*"//g')
  if [ -n "$neon_branch" ]; then
    text=${text//"$neon_branch"/}
  fi

  local exhaustion="limit|quota|cap|exceed|maximum"
  if printf '%s' "$text" | grep -qiE "already exists|duplicate"; then
    echo exists
  elif printf '%s' "$text" | grep -qiE "branch.*($exhaustion)|($exhaustion).*branch"; then
    echo cap
  else
    echo unknown
  fi
}

# Create a Neon branch forked from $NEON_PARENT_BRANCH (default: staging) and
# patch the worktree's .env to point at it. Self-heals a genuine branch cap via
# one GC retry. A name collision is reused when $reuse_existing is 1 (the caller
# is resuming an existing git branch) and fails loud otherwise — pass --fresh-db
# to recreate.
neon_create_branch_for_worktree() {
  local git_branch="$1" worktree_env="$2" fresh_db="${3:-0}" reuse_existing="${4:-0}"
  local reused=0
  if ! neon_enabled; then
    echo -e "${YELLOW}Neon branching disabled (NEON_API_KEY/NEON_PROJECT_ID not set) — using shared DB${NC}"
    return 0
  fi

  local neon_branch parent
  neon_branch=$(neon_branch_name "$git_branch")
  parent="${NEON_PARENT_BRANCH:-staging}"

  # Symmetrical with the delete guardrail: refuse to create/overwrite a
  # protected name no matter how the git branch was named.
  if is_protected_neon_branch "$neon_branch"; then
    echo -e "${RED}Error: refusing to provision protected Neon branch name '$neon_branch'${NC}" >&2
    return 1
  fi

  # Fresh-DB: nuke any existing branch first.
  if [ "$fresh_db" = "1" ]; then
    pnpm dlx "neonctl@$NEONCTL_VERSION" branches delete "$neon_branch" \
      --project-id "$NEON_PROJECT_ID" >/dev/null 2>&1 || true
  fi

  # Attempt create; classify any failure by its error text, with the branch name
  # excluded from that text (see neon_classify_create_error). An existing branch
  # is either reused or a hard stop; only genuine exhaustion runs GC and retries.
  local create_out
  create_out=$(pnpm dlx "neonctl@$NEONCTL_VERSION" branches create \
    --project-id "$NEON_PROJECT_ID" --name "$neon_branch" --parent "$parent" \
    --output json 2>&1) || {
    case "$(neon_classify_create_error "$create_out" "$neon_branch")" in
      exists)
        if [ "$fresh_db" = "1" ]; then
          # The pre-delete above silences its errors, so a delete that never
          # took lands here. Reusing now would hand back the exact stale
          # database --fresh-db was passed to destroy.
          echo -e "${RED}Error: Neon branch '$neon_branch' still exists after the --fresh-db delete.${NC}" >&2
          echo "Delete it by hand and retry:" >&2
          echo "  pnpm dlx neonctl@$NEONCTL_VERSION branches delete '$neon_branch' --project-id \"\$NEON_PROJECT_ID\"" >&2
          return 1
        elif [ "$reuse_existing" = "1" ]; then
          # Resuming an existing git branch (orchestrator RETRY or force-kill
          # recovery): its Neon branch was deliberately kept alongside it, so
          # reuse it and fall through to fetching its connection strings.
          echo -e "${YELLOW}Neon branch '$neon_branch' already exists — reusing it${NC}"
          reused=1
        else
          echo -e "${RED}Error: Neon branch '$neon_branch' already exists.${NC}" >&2
          echo "Run 'wt cleanup $git_branch' or pass --fresh-db to force recreate." >&2
          return 1
        fi
        ;;
      cap)
        echo -e "${YELLOW}Neon branch cap hit — running orphan GC...${NC}"
        neon_gc_orphans
        create_out=$(pnpm dlx "neonctl@$NEONCTL_VERSION" branches create \
          --project-id "$NEON_PROJECT_ID" --name "$neon_branch" --parent "$parent" \
          --output json 2>&1) || {
          echo -e "${RED}Error: Neon branch cap still exceeded after orphan GC.${NC}" >&2
          echo "$create_out" >&2
          return 1
        }
        ;;
      *)
        echo -e "${RED}Error: Neon branch create failed:${NC}" >&2
        echo "$create_out" >&2
        return 1
        ;;
    esac
  }

  local pooled unpooled
  pooled=$(pnpm dlx "neonctl@$NEONCTL_VERSION" connection-string "$neon_branch" \
    --project-id "$NEON_PROJECT_ID" --pooled 2>/dev/null)
  unpooled=$(pnpm dlx "neonctl@$NEONCTL_VERSION" connection-string "$neon_branch" \
    --project-id "$NEON_PROJECT_ID" 2>/dev/null)

  if [ -z "$pooled" ] || [ -z "$unpooled" ]; then
    echo -e "${RED}Error: could not fetch connection strings for Neon branch '$neon_branch'.${NC}" >&2
    if [ "$reused" = "0" ]; then
      # Don't leak the branch we just created. Best-effort delete. A reused
      # branch was not created here and holds the work being resumed — keep it.
      pnpm dlx "neonctl@$NEONCTL_VERSION" branches delete "$neon_branch" \
        --project-id "$NEON_PROJECT_ID" >/dev/null 2>&1 || true
    fi
    return 1
  fi

  # Ensure .env exists — if copy_untracked_files skipped it (main repo has no
  # .env) awk would fail under `set -e` *after* the Neon branch was created,
  # leaking a branch. Creating an empty .env here is the cheapest fix.
  [ -f "$worktree_env" ] || touch "$worktree_env"

  update_env_var DATABASE_URL "$pooled" "$worktree_env"
  update_env_var DATABASE_URL_UNPOOLED "$unpooled" "$worktree_env"
  if [ "$reused" = "1" ]; then
    echo -e "${GREEN}Neon branch '$neon_branch' reused${NC}"
  else
    echo -e "${GREEN}Neon branch '$neon_branch' created (forked from '$parent')${NC}"
  fi
}

# Delete the Neon branch that corresponds to a git branch. Never fails the
# overall cleanup — Neon API outage shouldn't block worktree removal.
neon_delete_branch_for_worktree() {
  local git_branch="$1"
  neon_enabled || return 0
  local neon_branch
  neon_branch=$(neon_branch_name "$git_branch")
  if is_protected_neon_branch "$neon_branch"; then
    echo -e "${YELLOW}Refusing to delete protected Neon branch '$neon_branch'${NC}" >&2
    return 0
  fi
  if pnpm dlx "neonctl@$NEONCTL_VERSION" branches delete "$neon_branch" \
    --project-id "$NEON_PROJECT_ID" >/dev/null 2>&1; then
    echo -e "${GREEN}Neon branch '$neon_branch' deleted${NC}"
  else
    echo -e "${YELLOW}Neon branch '$neon_branch' not found or already deleted${NC}"
  fi
}

print_usage() {
  echo "Usage: $0 <command> [branch-name|issue-id]"
  echo ""
  echo "Commands:"
  echo "  start [flags]          Start orchestrator in background (flags passed through)"
  echo "  stop                   Stop the running orchestrator"
  echo "  watch [interval]       Live dashboard with status + activity (default: 5s)"
  echo "  status [-v]            Show orchestrator and worker status (-v for details)"
  echo "  logs <issue> [lines]   Show recent Claude activity for a worker (default: 20 messages)"
  echo ""
  echo "  new <branch-name>      Create new worktree and start Claude Code"
  echo "  auto [issue-id|branch] Create worktree and run /auto-implement autonomously"
  echo "  resume <branch-name>   Open Claude Code in existing worktree"
  echo "  list                   List all active worktrees"
  echo "  sync <branch-name>     Sync permissions from worktree to main repo"
  echo "  sync-all               Sync permissions from all worktrees"
  echo "  cleanup <branch-name>  Remove a specific worktree (auto-syncs permissions)"
  echo "  cleanup-all            Remove all parallel worktrees (auto-syncs permissions)"
  echo ""
  echo "Examples:"
  echo "  $0 new feat/api-caching"
  echo "  $0 auto HON-51                        # Issue ID - creates auto/hon-51 branch"
  echo "  $0 auto 51                            # Just number - same as HON-51"
  echo "  $0 auto user/hon-51-feature-name      # Branch name from Linear (preferred)"
  echo "  $0 auto                               # Find next available issue"
  echo "  $0 resume feat/api-caching"
  echo "  $0 cleanup feat/api-caching"
}

# Copy a single untracked file to worktree.
# Args: $1=source_repo, $2=source_path, $3=dest_dir
copy_untracked_file() {
  local source_repo="$1"
  local source_path="$2"
  local dest_dir="$3"
  local source_file="$source_repo/$source_path"
  local dest_file="$dest_dir/$source_path"

  # Skip if source doesn't exist
  if [ ! -f "$source_file" ]; then
    return 1
  fi

  # Create destination directory if needed
  mkdir -p "$(dirname "$dest_file")"

  cp "$source_file" "$dest_file"

  return 0
}

# Copy all configured untracked files to worktree
# Args: $1=worktree_path
copy_untracked_files() {
  local worktree_path="$1"
  local main_repo=$(get_main_repo_path)
  local copied=()
  local skipped=()

  for entry in "${UNTRACKED_FILES[@]}"; do
    if copy_untracked_file "$main_repo" "$entry" "$worktree_path"; then
      copied+=("$entry")
    else
      skipped+=("$entry")
    fi
  done

  # Log results
  if [ ${#copied[@]} -gt 0 ]; then
    echo "Copied untracked files: ${copied[*]}"
  fi

  # Warn specifically about .env since it's critical
  for path in "${skipped[@]}"; do
    if [ "$path" = ".env" ]; then
      echo -e "${YELLOW}Warning: .env not found in main repo - worktree will lack environment variables${NC}"
    fi
  done
}

# Normalize branch name to filesystem-safe path. `/` becomes `--`, not a single
# `-`, so `feat/foo-bar` and `feat-foo/bar` don't derive the same worktree
# directory — the same collision neon_branch_name guards against.
normalize_branch() {
  echo "${1//\//--}"
}

# Get worktree path for a branch
# First checks git worktree list for actual path, falls back to derived path
get_worktree_path() {
  local branch="$1"

  # Look up actual path from git worktree list (using -F for literal matching)
  local actual_path=$(git -C "$REPO_ROOT" worktree list | grep -F "[$branch]" | awk '{print $1}')

  if [ -n "$actual_path" ] && [[ "$actual_path" == "$WORKTREE_BASE"* ]]; then
    echo "$actual_path"
    return
  fi

  # Fall back to derived path (for new worktrees).
  #
  # No single-dash fallback for worktrees predating the `/` -> `--` change:
  # the lookup above already resolves anything git has registered, so a
  # fallback could only ever fire on an UNREGISTERED leftover directory — and
  # returning that reintroduces the collision this change removes, handing a
  # new `feat/foo-bar` the stale directory left by `feat-foo/bar`.
  local normalized=$(normalize_branch "$branch")
  echo "$WORKTREE_BASE/$normalized"
}

# Create new worktree
cmd_new() {
  local branch=""
  local fresh_db=0
  local arg
  for arg in "$@"; do
    case "$arg" in
      --fresh-db) fresh_db=1 ;;
      -*)
        echo -e "${RED}Error: Unknown flag: $arg${NC}" >&2
        print_usage
        exit 1 ;;
      *)
        if [ -z "$branch" ]; then
          branch="$arg"
        else
          echo -e "${RED}Error: Unexpected extra argument: $arg${NC}" >&2
          print_usage
          exit 1
        fi ;;
    esac
  done

  if [ -z "$branch" ]; then
    echo -e "${RED}Error: Branch name required${NC}"
    print_usage
    exit 1
  fi

  local worktree_path=$(get_worktree_path "$branch")

  # Check if worktree already exists
  if [ -d "$worktree_path" ]; then
    echo -e "${YELLOW}Worktree already exists at $worktree_path${NC}"
    echo "Use 'resume' to open it, or 'cleanup' to remove it first."
    exit 1
  fi

  # Create worktree directory
  mkdir -p "$WORKTREE_BASE"

  echo -e "${BLUE}Creating worktree for branch: $branch${NC}"
  echo "Location: $worktree_path"
  echo ""

  # Create worktree with new branch from current HEAD
  git -C "$REPO_ROOT" worktree add -b "$branch" "$worktree_path"

  echo ""
  echo -e "${BLUE}Setting up worktree...${NC}"
  echo ""

  cd "$worktree_path"

  # Copy untracked files from main repo (.env, Claude settings, etc.)
  copy_untracked_files "$worktree_path"

  # Install dependencies BEFORE Neon provisioning so a pnpm failure (lockfile
  # conflict, registry 5xx, corrupt node_modules, OOM) can't leak a fresh
  # Neon branch. `db:generate` reads DATABASE_URL from the copied .env but
  # doesn't connect, so the shared URL is fine here.
  echo "Installing dependencies..."
  if command -v pnpm &> /dev/null; then
    pnpm install
    pnpm db:generate
  else
    echo -e "${YELLOW}Warning: pnpm not found, skipping dependency installation${NC}"
  fi

  # Provision a Neon branch and patch DATABASE_URL in the worktree .env.
  # No-op when NEON_API_KEY/NEON_PROJECT_ID are unset.
  neon_create_branch_for_worktree "$branch" "$worktree_path/.env" "$fresh_db" || exit 1

  echo ""
  echo -e "${GREEN}Worktree ready!${NC}"
  echo ""
  echo "Starting Claude Code..."
  echo "─────────────────────────────────────────"
  echo ""

  # Start Claude Code in the worktree
  # Unset ANTHROPIC_API_KEY so Claude CLI uses Max subscription instead of API credits
  exec env -u ANTHROPIC_API_KEY claude
}

# Fully autonomous worktree - creates worktree and runs /auto-implement
cmd_auto() {
  local arg=""
  local fresh_db=0
  local positional_arg=""
  local a
  for a in "$@"; do
    case "$a" in
      --fresh-db) fresh_db=1 ;;
      -*)
        echo -e "${RED}Error: Unknown flag: $a${NC}" >&2
        print_usage
        exit 1 ;;
      *)
        if [ -z "$positional_arg" ]; then
          positional_arg="$a"
        else
          echo -e "${RED}Error: Unexpected extra argument: $a${NC}" >&2
          print_usage
          exit 1
        fi ;;
    esac
  done
  arg="$positional_arg"

  local branch
  local issue_id
  local prompt

  # Parse argument - could be issue ID (HON-XX), branch name, or empty
  if [ -n "$arg" ]; then
    # Check if it looks like a branch name (contains / or starts with user/)
    if [[ "$arg" == *"/"* ]]; then
      # It's a branch name - extract issue ID from it
      branch="$arg"
      # Extract HON-XX pattern from branch name (case insensitive)
      issue_id=$(echo "$arg" | grep -oiE 'hon-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]')
      if [ -z "$issue_id" ]; then
        echo -e "${RED}Error: Could not extract issue ID from branch name: $arg${NC}"
        echo "Branch name should contain 'HON-XX' pattern (e.g., 'user/hon-51-feature-name')"
        exit 1
      fi
      prompt="/auto-implement $issue_id"
    else
      # It's an issue ID - normalize and create auto/ branch
      issue_id=$(echo "$arg" | tr '[:lower:]' '[:upper:]')
      # Add HON- prefix if just a number
      if [[ "$issue_id" =~ ^[0-9]+$ ]]; then
        issue_id="HON-$issue_id"
      fi
      branch="auto/$(echo "$issue_id" | tr '[:upper:]' '[:lower:]')"
      prompt="/auto-implement $issue_id"
    fi
  else
    # No argument - use timestamp for unique branch, let /auto-implement find next issue
    branch="auto/$(date +%Y%m%d-%H%M%S)"
    prompt="/auto-implement"
  fi

  local worktree_path=$(get_worktree_path "$branch")

  # Check if worktree already exists
  if [ -d "$worktree_path" ]; then
    echo -e "${YELLOW}Worktree already exists at $worktree_path${NC}"
    echo "Use 'resume' to open it, or 'cleanup' to remove it first."
    exit 1
  fi

  # Create worktree directory
  mkdir -p "$WORKTREE_BASE"

  echo -e "${BLUE}Creating autonomous worktree for: ${issue_id:-next issue}${NC}"
  echo "Branch: $branch"
  echo "Location: $worktree_path"
  echo ""

  # Fetch so the worktree branches from up-to-date origin/main. Fetch, not
  # pull: the parent checkout may be sitting on someone's feature branch
  # (parallel sessions do work there), and a pull would either fail or merge
  # into that branch.
  echo "Fetching latest origin/main..."
  git -C "$REPO_ROOT" fetch origin main 2>/dev/null || \
    echo -e "${YELLOW}Warning: Could not fetch origin/main (offline?) — branching from the last-known ref${NC}"

  # Create the worktree. When the branch already exists — an orchestrator RETRY
  # that preserved it to resume an open PR — check it out as-is instead of
  # recreating it from main, which would discard its commits.
  local reuse_branch=0
  if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$branch"; then
    echo "Reusing existing branch: $branch"
    reuse_branch=1
    git -C "$REPO_ROOT" worktree add "$worktree_path" "$branch"
  else
    # Explicit start ref: `worktree add -b` with no ref branches from the
    # parent checkout's HEAD, which is only `main` by convention — a parallel
    # session's feature checkout would silently leak its commits into every
    # autonomous branch (observed 2026-08-30 with HON-550's checkout).
    #
    # --no-track is required, not cosmetic: the start ref is remote-tracking, so
    # git's default branch.autoSetupMerge would set origin/main as this branch's
    # upstream. That made every phase heuristic read "pushed" from creation
    # (HON-576) and makes a bare `git pull` in the worktree merge main into the
    # feature branch. Do not drop the flag.
    git -C "$REPO_ROOT" worktree add -b "$branch" --no-track "$worktree_path" origin/main
  fi

  echo ""
  echo -e "${BLUE}Setting up worktree...${NC}"
  echo ""

  cd "$worktree_path"

  # Copy untracked files from main repo (.env, Claude settings, etc.)
  copy_untracked_files "$worktree_path"

  # Install dependencies BEFORE Neon provisioning so a pnpm failure can't
  # leak a fresh Neon branch. db:generate doesn't connect — shared DATABASE_URL
  # from the copied .env is sufficient.
  echo "Installing dependencies..."
  if command -v pnpm &> /dev/null; then
    pnpm install
    pnpm db:generate
  else
    echo -e "${YELLOW}Warning: pnpm not found, skipping dependency installation${NC}"
  fi

  # Provision a Neon branch and patch DATABASE_URL in the worktree .env.
  # No-op when NEON_API_KEY/NEON_PROJECT_ID are unset. Failure is fatal so
  # the orchestrator logs a clean failure and moves on (no silent shared-DB fallback).
  # A reused branch keeps its Neon branch too (RETRY skips neon-delete), so
  # tell the helper to reuse it rather than fail on "already exists".
  neon_create_branch_for_worktree "$branch" "$worktree_path/.env" "$fresh_db" "$reuse_branch" || exit 1

  echo ""
  echo -e "${GREEN}Worktree ready!${NC}"
  echo ""
  echo "Starting autonomous Claude Code with: $prompt"
  echo "─────────────────────────────────────────"
  echo ""

  # Start Claude Code with permissions bypassed and auto-implement prompt
  # Unset ANTHROPIC_API_KEY so Claude CLI uses Max subscription instead of API credits
  exec env -u ANTHROPIC_API_KEY claude --dangerously-skip-permissions --model "${CLAUDE_AUTO_MODEL:-claude-opus-5}" "$prompt"
}

# Resume existing worktree
cmd_resume() {
  local branch="$1"
  if [ -z "$branch" ]; then
    echo -e "${RED}Error: Branch name required${NC}"
    print_usage
    exit 1
  fi

  local worktree_path=$(get_worktree_path "$branch")

  if [ ! -d "$worktree_path" ]; then
    echo -e "${RED}Error: Worktree not found at $worktree_path${NC}"
    echo "Use 'list' to see available worktrees, or 'new' to create one."
    exit 1
  fi

  echo -e "${BLUE}Resuming worktree: $branch${NC}"
  echo "Location: $worktree_path"
  echo ""

  cd "$worktree_path"
  # Unset ANTHROPIC_API_KEY so Claude CLI uses Max subscription instead of API credits
  exec env -u ANTHROPIC_API_KEY claude --resume
}

# Commits on a worktree's HEAD that are not on origin/main — the ref the
# worktree was branched from. `wt auto` fetches origin/main immediately before
# the `worktree add ... origin/main` at cmd_auto above, so this is exactly 0 at
# creation, and stays equal to the worker's own commits whether origin/main
# later advances, the worker rebases onto it, or merges it in.
#
# NOT the operator's local `main` (HON-601). Nothing in the unattended pipeline
# advances refs/heads/main, while every merge advances origin/main, so a lagging
# local main inflated every count by the number of merges the operator had not
# pulled — which is what made a brand-new worker show `Reviewing` in `wt watch`.
#
# Fully qualified refs/remotes/origin/main rather than `origin/main`, matching
# the pushed-check below, so a local branch literally named `origin/main` can
# never shadow it. Worktrees share refs with the primary checkout, so the ref
# resolves from inside the worktree.
#
# Prints the count, or nothing when rev-list fails (a pruned worktree admin dir,
# a missing ref). There is deliberately NO fallback to local main: it would
# silently reintroduce the bug on exactly the machines where it matters. Callers
# guard with `[[ "$ahead" =~ ^[0-9]+$ ]] || ahead=0`.
#
# Deliberately duplicated in orchestrator.sh, which does not source this script
# (see the get_worktree_path note there).
#
# Usage: commits_ahead <wt_path>
commits_ahead() {
  git -C "$1" rev-list --count refs/remotes/origin/main..HEAD 2>/dev/null
}

# Phase shown in the `wt status` / `wt watch` worker tables.
#
# `ahead` and `dirty` are passed in rather than recomputed: both call sites
# already derive them for the progress column, and `wt watch` redraws on a
# timer — a second `git status` per worker per tick is pure waste. `ahead` comes
# from commits_ahead, i.e. it is measured against origin/main as last fetched,
# never the operator's local main.
#
# Title Case here vs. kebab-case in orchestrator.sh's detect_phase: the two are
# read by different audiences (a human table vs. the outcome log and stranded
# reports). Unifying them across the two scripts is HON-572 follow-up #5.
#
# Usage: wt_detect_phase <log_file> <wt_path> <branch> <ahead> <dirty>
wt_detect_phase() {
  local log_file="$1" wt_path="$2" branch="$3" ahead="${4:-0}" dirty="${5:-}"
  # `git rev-list` returns empty on failure, and `[ "" -gt 0 ]` is a hard error.
  [[ "$ahead" =~ ^[0-9]+$ ]] || ahead=0

  [ -f "$log_file" ] || { echo "Initializing"; return; }

  # Strategy 1: skill markers — these win over every git heuristic below.
  local last_marker
  last_marker=$(grep -o '\[[^]]*:complete\]' "$log_file" 2>/dev/null | tail -1) || true
  case "$last_marker" in
    "[plan-issue:complete]")      echo "Implementing"; return ;;
    "[implement-issue:complete]") echo "Reviewing"; return ;;
    "[branch-review:complete]")   echo "Committing"; return ;;
    "[commit:complete]")          echo "PR review"; return ;;
    "[create-pr:complete]")       echo "PR review"; return ;;
    "[review-pr:complete]")       echo "Merging"; return ;;
    "[merge:complete]")           echo "Done"; return ;;
    # Any other […:complete] marker — [next-issue:complete],
    # [triage-pr-comments:complete] and friends are all real — falls through to
    # the heuristics below rather than blanking the column to "Unknown", which
    # is what orchestrator.sh's detect_phase already does.
    *) ;;
  esac

  # Strategy 2: auto-implement completion.
  if grep -qE '\[auto-implement\].*(cycle complete|PR merged)' "$log_file" 2>/dev/null; then
    echo "Done"; return
  fi

  # Strategy 3: git heuristics.
  if [ -d "$wt_path/.git" ] || [ -f "$wt_path/.git" ]; then
    # Has THIS branch's work been pushed? Three conditions, each closing a
    # different false positive — see detect_phase in orchestrator.sh for the
    # long version (HON-576). In short: an upstream is set by the origin/main
    # start ref before any commit exists, and the remote ref alone survives the
    # run that created it, so a re-picked issue would inherit a stale one.
    if [ "$ahead" -gt 0 ] &&
       git -C "$wt_path" show-ref --verify --quiet "refs/remotes/origin/$branch" &&
       git -C "$wt_path" merge-base --is-ancestor "refs/remotes/origin/$branch" HEAD 2>/dev/null; then
      echo "PR review"; return
    fi
    if [ "$ahead" -gt 0 ]; then
      if [ -n "$dirty" ]; then echo "Implementing"; else echo "Reviewing"; fi
      return
    fi
    if [ -n "$dirty" ]; then echo "Implementing"; return; fi
  fi

  # Strategy 4: log content fallback.
  if grep -q "Starting autonomous Claude Code" "$log_file" 2>/dev/null; then
    echo "Planning"; return
  fi
  echo "Initializing"
}

# Show orchestrator and worker status
cmd_status() {
  local verbose=false
  if [ "${1:-}" = "-v" ] || [ "${1:-}" = "--verbose" ]; then
    verbose=true
  fi
  local status_file="$WORKTREE_BASE/orchestrator-status.json"

  if [ ! -f "$status_file" ]; then
    echo -e "${YELLOW}No orchestrator status file found.${NC}"
    echo "Start the orchestrator with: wt start"
    return
  fi

  local status
  status=$(cat "$status_file" 2>/dev/null) || {
    echo -e "${RED}Error reading status file${NC}"
    return 1
  }

  local orch_pid started_at last_poll max_workers
  orch_pid=$(echo "$status" | jq -r '.pid')
  started_at=$(echo "$status" | jq -r '.started_at')
  last_poll=$(echo "$status" | jq -r '.last_poll')
  max_workers=$(echo "$status" | jq -r '.max_workers')

  # Check if orchestrator process is alive
  local orch_alive=false
  if kill -0 "$orch_pid" 2>/dev/null; then
    orch_alive=true
  fi

  # Calculate uptime and last poll age
  local now
  now=$(date +%s)

  local uptime_str=""
  if [ -n "$started_at" ] && [ "$started_at" != "null" ]; then
    local start_epoch
    start_epoch=$(TZ=UTC date -jf '%Y-%m-%dT%H:%M:%SZ' "$started_at" '+%s' 2>/dev/null) || \
    start_epoch=$(date -d "$started_at" '+%s' 2>/dev/null) || start_epoch=0
    if [ "$start_epoch" -gt 0 ]; then
      local uptime_secs=$((now - start_epoch))
      uptime_str=$(format_duration "$uptime_secs")
    fi
  fi

  local poll_age_str=""
  if [ -n "$last_poll" ] && [ "$last_poll" != "null" ]; then
    local poll_epoch
    poll_epoch=$(TZ=UTC date -jf '%Y-%m-%dT%H:%M:%SZ' "$last_poll" '+%s' 2>/dev/null) || \
    poll_epoch=$(date -d "$last_poll" '+%s' 2>/dev/null) || poll_epoch=0
    if [ "$poll_epoch" -gt 0 ]; then
      local poll_age=$((now - poll_epoch))
      poll_age_str=$(format_duration "$poll_age")
    fi
  fi

  # Header
  if [ "$orch_alive" = true ]; then
    echo -e "${GREEN}Orchestrator running${NC} (PID $orch_pid, uptime ${uptime_str:-unknown}, last poll ${poll_age_str:-unknown} ago)"
  else
    echo -e "${YELLOW}Orchestrator not running${NC} (last active: ${poll_age_str:-unknown} ago)"
  fi
  echo ""

  # Circuit breaker status
  local cb_failures cb_paused
  cb_failures=$(echo "$status" | jq -r '.circuit_breaker.consecutive_failures')
  cb_paused=$(echo "$status" | jq -r '.circuit_breaker.paused_until')
  if [ "$cb_paused" != "null" ] && [ -n "$cb_paused" ]; then
    local pause_epoch
    pause_epoch=$(TZ=UTC date -jf '%Y-%m-%dT%H:%M:%SZ' "$cb_paused" '+%s' 2>/dev/null) || \
    pause_epoch=$(date -d "$cb_paused" '+%s' 2>/dev/null) || pause_epoch=0
    if [ "$pause_epoch" -gt "$now" ]; then
      local remaining=$((pause_epoch - now))
      echo -e "${YELLOW}  Circuit breaker active — paused for $(format_duration "$remaining")${NC}"
      echo ""
    fi
  fi

  # Workers
  local worker_count
  worker_count=$(echo "$status" | jq '.workers | length')

  if [ "$worker_count" -eq 0 ]; then
    echo "  No active workers"
    echo ""
    echo "0/$max_workers worker slots in use"
    return
  fi

  # Table header
  printf "  ${DIM}%-9s %-16s %9s %11s  %s${NC}\n" "ISSUE" "PHASE" "TIME" "PROGRESS" "BRANCH"

  local i=0
  while [ "$i" -lt "$worker_count" ]; do
    local worker
    worker=$(echo "$status" | jq ".workers[$i]")

    local w_issue w_pid w_branch w_started w_log
    w_issue=$(echo "$worker" | jq -r '.issue')
    w_pid=$(echo "$worker" | jq -r '.pid')
    w_branch=$(echo "$worker" | jq -r '.branch')
    w_started=$(echo "$worker" | jq -r '.started_at')
    w_log=$(echo "$worker" | jq -r '.log_file')

    # Elapsed time
    local elapsed_str="?"
    local w_start_epoch
    w_start_epoch=$(TZ=UTC date -jf '%Y-%m-%dT%H:%M:%SZ' "$w_started" '+%s' 2>/dev/null) || \
    w_start_epoch=$(date -d "$w_started" '+%s' 2>/dev/null) || w_start_epoch=0
    if [ "$w_start_epoch" -gt 0 ]; then
      local w_elapsed=$((now - w_start_epoch))
      elapsed_str=$(format_duration "$w_elapsed")
    fi

    # Git progress (computed first, used by phase detection)
    local progress=""
    local wt_path
    wt_path=$(get_worktree_path "$w_branch")
    if [ -d "$wt_path/.git" ] || [ -f "$wt_path/.git" ]; then
      local ahead=0
      ahead=$(commits_ahead "$wt_path") || true
      # Empty on failure, and `[ "" -gt 0 ]` is a hard error — same guard as
      # wt_detect_phase applies to its own argument.
      [[ "$ahead" =~ ^[0-9]+$ ]] || ahead=0
      local dirty=""
      if [ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ]; then
        dirty="+"
      fi
      progress="${ahead} commit(s)${dirty}"
    else
      progress="initializing"
    fi

    # Phase detection: log markers → auto-implement markers → git heuristics
    local phase
    phase=$(wt_detect_phase "$w_log" "$wt_path" "$w_branch" "$ahead" "$dirty")

    # Worker alive check
    local alive_indicator=""
    if ! kill -0 "$w_pid" 2>/dev/null; then
      alive_indicator=" ${RED}(dead)${NC}"
    fi

    # Color the phase
    local phase_color="$NC"
    case "$phase" in
      Initializing) phase_color="$DIM" ;;
      Planning)     phase_color="$BLUE" ;;
      Implementing) phase_color="$GREEN" ;;
      Reviewing)    phase_color="$YELLOW" ;;
      Committing)   phase_color="$BLUE" ;;
      "PR review")  phase_color="$YELLOW" ;;
      Merging)      phase_color="$GREEN" ;;
      Done)         phase_color="$GREEN" ;;
    esac

    printf "  %-9s ${phase_color}%-16s${NC} %9s %11s  %s%b\n" \
      "$w_issue" "$phase" "$elapsed_str" "$progress" "$w_branch" "$alive_indicator"

    # Verbose: show changed files and log tail
    if [ "$verbose" = true ]; then
      echo ""

      # Show changed files in worktree
      if [ -d "$wt_path/.git" ] || [ -f "$wt_path/.git" ]; then
        local changed_files
        changed_files=$(git -C "$wt_path" diff --name-only HEAD 2>/dev/null) || true
        local staged_files
        staged_files=$(git -C "$wt_path" diff --cached --name-only 2>/dev/null) || true
        local untracked_files
        untracked_files=$(git -C "$wt_path" ls-files --others --exclude-standard 2>/dev/null) || true

        # Combine and deduplicate
        local all_files
        all_files=$(printf '%s\n%s\n%s' "$changed_files" "$staged_files" "$untracked_files" | sort -u | grep -v '^$') || true

        if [ -n "$all_files" ]; then
          local file_count
          file_count=$(echo "$all_files" | wc -l | tr -d ' ')
          echo -e "    ${DIM}Changed files (${file_count}):${NC}"
          echo "$all_files" | head -15 | while IFS= read -r f; do
            printf "      ${DIM}%s${NC}\n" "$f"
          done
          if [ "$file_count" -gt 15 ]; then
            echo -e "      ${DIM}... and $((file_count - 15)) more${NC}"
          fi
        fi

        # Show diff stat for uncommitted changes
        if [ -n "$all_files" ]; then
          local diff_summary
          diff_summary=$(git -C "$wt_path" diff --shortstat 2>/dev/null) || true
          if [ -n "$diff_summary" ]; then
            printf "      ${DIM}%s${NC}\n" "$diff_summary"
          fi
        fi

        # Show recent commits on branch
        if [ "$ahead" -gt 0 ]; then
          echo ""
          echo -e "    ${DIM}Commits (${ahead}):${NC}"
          git -C "$wt_path" log refs/remotes/origin/main..HEAD --oneline 2>/dev/null | head -5 | while IFS= read -r line; do
            printf "      ${DIM}%s${NC}\n" "$line"
          done
          if [ "$ahead" -gt 5 ]; then
            echo -e "      ${DIM}... and $((ahead - 5)) more${NC}"
          fi
        fi

        # Show PR URL if pushed
        local pr_url
        # Cheap guard: only ask GitHub about branches whose work is actually on
        # the remote. `@{upstream}` passed on every unpushed autonomous branch
        # (HON-576), and a bare remote-ref test would still pass on a ref left
        # behind by a previous run of the same issue — which makes `gh pr view`
        # resolve THAT run's PR and print its URL under a worker that has
        # pushed nothing.
        pr_url=$(git -C "$wt_path" merge-base --is-ancestor "refs/remotes/origin/$w_branch" HEAD 2>/dev/null && \
          gh pr view "$w_branch" --json url --jq .url 2>/dev/null) || true
        if [ -n "$pr_url" ]; then
          echo ""
          printf "    ${DIM}PR: %s${NC}\n" "$pr_url"
        fi
      fi

      echo ""
    fi

    i=$((i + 1))
  done

  echo ""
  echo "$worker_count/$max_workers worker slots in use · $cb_failures circuit breaker failure(s)"

  if [ "$orch_alive" = true ]; then
    echo ""
    if [ "$verbose" = true ]; then
      echo -e "${DIM}Tip: watch -n 10 wt status -v${NC}"
    else
      echo -e "${DIM}Tip: wt status -v for details · watch -n 5 wt status${NC}"
    fi
  fi
}

# Format seconds into human-readable duration (e.g., "2h15m", "5m30s")
format_duration() {
  local secs="$1"
  if [ "$secs" -ge 3600 ]; then
    printf "%dh%dm" $((secs / 3600)) $(( (secs % 3600) / 60 ))
  elif [ "$secs" -ge 60 ]; then
    printf "%dm%ds" $((secs / 60)) $((secs % 60))
  else
    printf "%ds" "$secs"
  fi
}

# List all worktrees
cmd_list() {
  echo -e "${BLUE}Active worktrees:${NC}"
  echo ""

  # Get all worktrees
  local worktrees=$(git -C "$REPO_ROOT" worktree list)

  # Check if we have any parallel worktrees
  if ! echo "$worktrees" | grep -q "$WORKTREE_BASE"; then
    echo "No parallel worktrees found."
    echo ""
    echo "Create one with: $0 new <branch-name>"
    return
  fi

  # Show parallel worktrees with details
  echo "$worktrees" | while read -r line; do
    local path=$(echo "$line" | awk '{print $1}')
    local branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')

    # Only show worktrees in our managed directory
    if [[ "$path" == "$WORKTREE_BASE"* ]]; then
      local last_commit=$(git -C "$path" log -1 --format="%s" 2>/dev/null || echo "unknown")
      local short_commit=$(git -C "$path" log -1 --format="%h" 2>/dev/null || echo "???")

      echo -e "${GREEN}$branch${NC}"
      echo "  Path: $path"
      echo "  Last: $short_commit - $last_commit"
      echo ""
    fi
  done

  echo "─────────────────────────────────────────"
  echo "Run 'wt status' for orchestrator detail, 'wt watch' for a live dashboard."
}

# Cleanup a specific worktree
cmd_cleanup() {
  local branch="$1"

  # If running from within a worktree, block with helpful message
  if is_in_worktree; then
    local current_branch=$(git branch --show-current)
    local main_repo=$(git rev-parse --git-common-dir | sed 's|/.git$||')

    # If no branch specified, use current branch in the message
    if [ -z "$branch" ]; then
      branch="$current_branch"
    fi

    # Block if trying to clean up the current worktree
    if [ "$current_branch" = "$branch" ]; then
      echo -e "${RED}Error: Cannot clean up current worktree from within it${NC}"
      echo ""
      echo "Detected branch: $current_branch"
      echo ""
      echo "Please exit this directory first:"
      echo "  cd $main_repo"
      echo "  ./scripts/worktree-claude.sh cleanup $branch"
      exit 1
    fi
  fi

  if [ -z "$branch" ]; then
    echo -e "${RED}Error: Branch name required${NC}"
    print_usage
    exit 1
  fi

  local worktree_path=$(get_worktree_path "$branch")

  if [ ! -d "$worktree_path" ]; then
    echo -e "${YELLOW}Worktree not found at $worktree_path${NC}"
    return
  fi

  # Check worktree status before removing
  local status=$(get_worktree_status "$worktree_path")

  echo -e "${BLUE}Worktree: $branch${NC}"
  echo "Location: $worktree_path"
  echo ""

  if [ "$status" = "merged" ]; then
    echo -e "Status: ${GREEN}$status${NC} - safe to remove"
    echo ""
    read -p "Remove this worktree? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Cancelled."
      return
    fi
  else
    echo -e "Status: ${RED}$status${NC}"
    echo ""
    echo -e "${YELLOW}Warning: This worktree has work that may be lost!${NC}"
    echo ""
    read -p "Remove anyway? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Cancelled."
      return
    fi
  fi

  # Sync permissions back to main repo before cleanup
  sync_permissions "$worktree_path"

  # Remove the worktree
  git -C "$REPO_ROOT" worktree remove "$worktree_path" --force

  # Delete the paired Neon branch (no-op if Neon branching disabled)
  neon_delete_branch_for_worktree "$branch"

  # Optionally delete the branch if it wasn't pushed
  echo ""
  read -p "Delete the branch '$branch' as well? (y/N) " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    git -C "$REPO_ROOT" branch -D "$branch" 2>/dev/null || echo "Branch already deleted or doesn't exist"
  fi

  echo -e "${GREEN}Cleanup complete${NC}"
}

# Detect if we're in a worktree (returns 0 if in worktree, 1 if in main repo)
is_in_worktree() {
  local git_common=$(git rev-parse --git-common-dir 2>/dev/null)
  local git_dir=$(git rev-parse --git-dir 2>/dev/null)
  [ "$git_common" != "$git_dir" ]
}

# Check if a worktree has uncommitted changes
has_uncommitted_changes() {
  local path="$1"
  [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]
}

# Check if a branch has unpushed commits
has_unpushed_commits() {
  local path="$1"
  local branch=$(git -C "$path" branch --show-current 2>/dev/null)

  # Check if remote tracking branch exists
  if git -C "$path" rev-parse --verify "origin/$branch" &>/dev/null; then
    # Has commits ahead of remote
    local ahead=$(git -C "$path" rev-list --count "origin/$branch..$branch" 2>/dev/null || echo "0")
    [ "$ahead" -gt 0 ]
  else
    # No remote tracking branch - consider unpushed if branch has commits not in main
    local ahead=$(git -C "$path" rev-list --count "main..$branch" 2>/dev/null || echo "0")
    [ "$ahead" -gt 0 ]
  fi
}

# Check if a branch is merged into main (handles squash merges)
is_branch_merged() {
  local path="$1"
  local branch=$(git -C "$path" branch --show-current 2>/dev/null)

  # First, check if the branch has any commits ahead of main
  # A branch with no commits ahead is NOT merged - it just hasn't diverged yet
  local ahead=$(git -C "$REPO_ROOT" rev-list --count "main..$branch" 2>/dev/null || echo "0")
  if [ "$ahead" = "0" ]; then
    # No commits ahead of main - this is a fresh branch, not a merged one
    return 1
  fi

  # Method 1: Check if branch is an ancestor of main (regular merge)
  if git -C "$REPO_ROOT" merge-base --is-ancestor "$branch" main 2>/dev/null; then
    return 0
  fi

  # Method 2: Check if PR for this branch was merged (handles squash merges)
  # Look for a merged PR with this branch as head
  if command -v gh &> /dev/null; then
    local pr_state=$(gh pr list --head "$branch" --state merged --json state --jq '.[0].state' 2>/dev/null)
    if [ "$pr_state" = "MERGED" ]; then
      return 0
    fi
  fi

  return 1
}

# Get worktree status summary
get_worktree_status() {
  local path="$1"
  local status=""

  # Check uncommitted changes first (always relevant)
  if has_uncommitted_changes "$path"; then
    status="uncommitted changes"
  fi

  # Check if merged (do this before unpushed check)
  # Squash-merged branches will always have "unpushed" original commits
  if is_branch_merged "$path"; then
    if [ -n "$status" ]; then
      # Has uncommitted changes but PR was merged - unusual state
      status="$status (but merged)"
    else
      status="merged"
    fi
    echo "$status"
    return
  fi

  # Only check unpushed if not merged (avoids false positives for squash merges)
  if has_unpushed_commits "$path"; then
    if [ -n "$status" ]; then
      status="$status, unpushed commits"
    else
      status="unpushed commits"
    fi
  fi

  if [ -z "$status" ]; then
    status="unmerged"
  fi

  echo "$status"
}

# Cleanup all parallel worktrees
cmd_cleanup_all() {
  # If running from within a worktree, warn and exit
  if is_in_worktree; then
    echo -e "${RED}Error: Cannot run cleanup-all from within a worktree${NC}"
    echo ""
    echo "You're currently in: $(pwd)"
    echo ""
    echo "Please run from the main repo:"
    echo "  cd $(git rev-parse --git-common-dir | sed 's|/.git$||')"
    echo "  ./scripts/worktree-claude.sh cleanup-all"
    exit 1
  fi

  # Collect worktree info first
  local safe_worktrees=()
  local safe_branches=()
  local unsafe_worktrees=()
  local unsafe_branches=()
  local all_paths=()
  local all_branches=()
  local all_statuses=()

  while read -r line; do
    local path=$(echo "$line" | awk '{print $1}')
    local branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')

    if [[ "$path" == "$WORKTREE_BASE"* ]]; then
      local status=$(get_worktree_status "$path")
      all_paths+=("$path")
      all_branches+=("$branch")
      all_statuses+=("$status")

      if [ "$status" = "merged" ]; then
        safe_worktrees+=("$path")
        safe_branches+=("$branch")
      else
        unsafe_worktrees+=("$path")
        unsafe_branches+=("$branch")
      fi
    fi
  done < <(git -C "$REPO_ROOT" worktree list)

  if [ ${#all_paths[@]} -eq 0 ]; then
    echo "No parallel worktrees found."
    return
  fi

  # Show status of all worktrees
  echo -e "${BLUE}Worktree status:${NC}"
  echo ""
  for i in "${!all_paths[@]}"; do
    local status="${all_statuses[$i]}"
    local branch="${all_branches[$i]}"
    local path="${all_paths[$i]}"

    if [ "$status" = "merged" ]; then
      echo -e "  ${GREEN}✓${NC} $branch ($status)"
    else
      echo -e "  ${YELLOW}!${NC} $branch (${RED}$status${NC})"
    fi
  done
  echo ""

  # Handle based on what we found
  if [ ${#unsafe_worktrees[@]} -eq 0 ]; then
    # All worktrees are safe to remove
    echo -e "${GREEN}All worktrees are merged and safe to remove.${NC}"
    read -p "Remove all ${#safe_worktrees[@]} worktree(s)? (y/N) " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Cancelled."
      return
    fi

    for i in "${!safe_worktrees[@]}"; do
      local path="${safe_worktrees[$i]}"
      local branch="${safe_branches[$i]}"
      sync_permissions "$path"
      echo "Removing: $path"
      if git -C "$REPO_ROOT" worktree remove "$path" --force 2>/dev/null; then
        neon_delete_branch_for_worktree "$branch"
      else
        echo -e "${YELLOW}Worktree remove failed for $path — keeping Neon branch${NC}" >&2
      fi
    done
  elif [ ${#safe_worktrees[@]} -eq 0 ]; then
    # No safe worktrees, all have work in progress
    echo -e "${YELLOW}All worktrees have work in progress.${NC}"
    echo ""
    echo "Options:"
    echo "  1) Cancel - keep all worktrees"
    echo "  2) Force remove all (will lose uncommitted/unpushed work!)"
    echo ""
    read -p "Choose [1-2]: " -n 1 -r
    echo ""

    if [[ $REPLY == "2" ]]; then
      echo ""
      echo -e "${RED}WARNING: This will permanently delete uncommitted/unpushed work!${NC}"
      read -p "Type 'yes' to confirm: " confirm
      if [ "$confirm" = "yes" ]; then
        for i in "${!unsafe_worktrees[@]}"; do
          local path="${unsafe_worktrees[$i]}"
          local branch="${unsafe_branches[$i]}"
          sync_permissions "$path"
          echo "Force removing: $path"
          if git -C "$REPO_ROOT" worktree remove "$path" --force 2>/dev/null; then
            neon_delete_branch_for_worktree "$branch"
          else
            echo -e "${YELLOW}Worktree remove failed for $path — keeping Neon branch${NC}" >&2
          fi
        done
      else
        echo "Cancelled."
        return
      fi
    else
      echo "Cancelled."
      return
    fi
  else
    # Mix of safe and unsafe worktrees
    echo "Options:"
    echo "  1) Remove only merged worktrees (${#safe_worktrees[@]} worktree(s))"
    echo "  2) Force remove all (will lose uncommitted/unpushed work!)"
    echo "  3) Cancel"
    echo ""
    read -p "Choose [1-3]: " -n 1 -r
    echo ""

    case $REPLY in
      1)
        for i in "${!safe_worktrees[@]}"; do
          local path="${safe_worktrees[$i]}"
          local branch="${safe_branches[$i]}"
          sync_permissions "$path"
          echo "Removing: $path"
          if git -C "$REPO_ROOT" worktree remove "$path" --force 2>/dev/null; then
            neon_delete_branch_for_worktree "$branch"
          else
            echo -e "${YELLOW}Worktree remove failed for $path — keeping Neon branch${NC}" >&2
          fi
        done
        echo ""
        echo -e "${YELLOW}Kept ${#unsafe_worktrees[@]} worktree(s) with work in progress.${NC}"
        ;;
      2)
        echo ""
        echo -e "${RED}WARNING: This will permanently delete uncommitted/unpushed work!${NC}"
        read -p "Type 'yes' to confirm: " confirm
        if [ "$confirm" = "yes" ]; then
          for i in "${!all_paths[@]}"; do
            local path="${all_paths[$i]}"
            local branch="${all_branches[$i]}"
            sync_permissions "$path"
            echo "Force removing: $path"
            if git -C "$REPO_ROOT" worktree remove "$path" --force 2>/dev/null; then
              neon_delete_branch_for_worktree "$branch"
            else
              echo -e "${YELLOW}Worktree remove failed for $path — keeping Neon branch${NC}" >&2
            fi
          done
        else
          echo "Cancelled."
          return
        fi
        ;;
      *)
        echo "Cancelled."
        return
        ;;
    esac
  fi

  # Prune any stale worktrees
  git -C "$REPO_ROOT" worktree prune

  echo -e "${GREEN}Cleanup complete${NC}"
}

# Sync permissions from a specific worktree
cmd_sync() {
  local branch="$1"
  if [ -z "$branch" ]; then
    echo -e "${RED}Error: Branch name required${NC}"
    print_usage
    exit 1
  fi

  local worktree_path=$(get_worktree_path "$branch")

  if [ ! -d "$worktree_path" ]; then
    echo -e "${RED}Error: Worktree not found at $worktree_path${NC}"
    echo "Use 'list' to see available worktrees."
    exit 1
  fi

  echo -e "${BLUE}Syncing permissions from: $branch${NC}"
  sync_permissions "$worktree_path"
  echo -e "${GREEN}Done${NC}"
}

# Sync permissions from all worktrees
cmd_sync_all() {
  echo -e "${BLUE}Syncing permissions from all worktrees...${NC}"
  echo ""

  local found=false

  # Get all worktrees in our managed directory
  while read -r line; do
    local path=$(echo "$line" | awk '{print $1}')
    local branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')

    if [[ "$path" == "$WORKTREE_BASE"* ]]; then
      found=true
      echo "Checking: $branch"
      sync_permissions "$path"
    fi
  done < <(git -C "$REPO_ROOT" worktree list)

  if [ "$found" = false ]; then
    echo "No parallel worktrees found."
  fi

  echo ""
  echo -e "${GREEN}Sync complete${NC}"
}

# ─── Shared: timezone offset (computed once) ──────────────────────────────────

get_tz_offset_sec() {
  local tz_raw tz_sign tz_hours tz_mins
  tz_raw=$(date +%z)
  tz_sign="${tz_raw:0:1}"
  tz_hours=$((10#${tz_raw:1:2}))
  tz_mins=$((10#${tz_raw:3:2}))
  local offset=$(( tz_hours * 3600 + tz_mins * 60 ))
  [ "$tz_sign" = "-" ] && offset=$(( -offset ))
  echo "$offset"
}

# ─── Shared: jq filter for JSONL → readable log ──────────────────────────────

# Shared jq program used by both cmd_logs and cmd_watch.
# Expects: --argjson tz <offset_sec>
# Input: one JSONL line per invocation (or piped stream)
JQ_LOG_FILTER='
  def short_path: (. // "?" | split("/") | last);
  def local_ts:
    if (. // "" | length) < 16 then "     "
    else
      (.[11:13] | tonumber) as $h |
      (.[14:16] | tonumber) as $m |
      (($h * 3600 + $m * 60 + $tz) % 86400) |
      if . < 0 then . + 86400 else . end |
      "\(. / 3600 | floor | tostring | if length < 2 then "0" + . else . end):\(. % 3600 / 60 | floor | tostring | if length < 2 then "0" + . else . end)"
    end;

  if .type == "assistant" then
    (.timestamp // "" | local_ts) as $ts |
    [.message.content[] |
      if .type == "text" then
        "        \(.text | gsub("\n"; "\n        ") | .[0:500])"
      elif .type == "tool_use" then
        if .name == "Edit" then
          "\($ts)  Edit " + (.input.file_path | short_path)
        elif .name == "Write" then
          "\($ts)  Write " + (.input.file_path | short_path)
        elif .name == "Read" then
          "\($ts)  Read " + (.input.file_path | short_path)
        elif .name == "Bash" then
          "\($ts)  $ " + (.input.description // (.input.command // "?" | split("\n") | first | .[0:100]))
        elif .name == "Grep" then
          "\($ts)  Grep " + (.input.pattern // "?") + " in " + (.input.path // "." | short_path)
        elif .name == "Glob" then
          "\($ts)  Glob " + (.input.pattern // "?")
        elif .name == "Agent" then
          "\($ts)  Agent: " + (.input.description // "?")
        elif .name == "Skill" then
          "\($ts)  /" + (.input.skill // "?")
        elif .name == "TodoWrite" then
          empty
        elif (.name | startswith("mcp__")) then
          "\($ts)  " + (.name | split("__") | .[1:] | join("."))
        else
          "\($ts)  " + .name
        end
      else empty
      end
    ] | join("\n")
  elif .type == "user" then
    (.message.content | if type == "array" then
      [.[] |
        if .type == "tool_result" and .is_error == true then
          "  \u001b[31m✗ " + (.content | tostring | .[0:150]) + "\u001b[0m"
        else empty
        end
      ] | if length > 0 then join("\n") else empty end
    else empty end)
  else empty
  end
'

# ─── Shared: render JSONL tail into readable log lines ────────────────────────

# Usage: render_log_lines <jsonl_file> <num_lines> <tz_offset>
# Outputs formatted log lines to stdout
render_log_lines() {
  local jsonl_file="$1" num_lines="$2" tz_offset="$3"
  tail -"$num_lines" "$jsonl_file" 2>/dev/null | \
    jq -r --argjson tz "$tz_offset" "$JQ_LOG_FILTER" 2>/dev/null | \
    grep -v '^$' | \
    sed -E 's|(lin_api_\|sk-ant-\|Bearer \|Authorization: )[^ "]+|\1***|g' | \
    sed -E "s|$HOME/.worktrees/[^/]+/[^/]+/||g"
}

# ─── Shared: find JSONL session file for an issue ─────────────────────────────

# Usage: find_session_jsonl <search_term>
# Sets REPLY to the jsonl file path, or empty if not found
find_session_jsonl() {
  local search_term="$1"
  local session_dir
  session_dir=$(find "$HOME/.claude/projects" -maxdepth 1 -type d -iname "*worktrees*${REPO_NAME}*${search_term}*" 2>/dev/null | head -1)
  [ -z "$session_dir" ] && REPLY="" && return 1
  REPLY=$(ls -t "$session_dir"/*.jsonl 2>/dev/null | head -1)
  [ -z "$REPLY" ] && return 1
  return 0
}

# Show recent Claude activity from session JSONL
cmd_logs() {
  local query="$1"
  local lines="${2:-20}"

  if [ -z "$query" ]; then
    echo -e "${RED}Error: Issue ID or branch name required${NC}"
    echo "Usage: wt logs <issue-id|branch> [lines]"
    echo "Example: wt logs HON-373"
    echo "         wt logs HON-373 50"
    exit 1
  fi

  # Normalize issue ID
  local search_term
  if [[ "$query" =~ ^[0-9]+$ ]]; then
    search_term="hon-${query}"
  else
    search_term=$(echo "$query" | tr '[:upper:]' '[:lower:]')
  fi

  if ! find_session_jsonl "$search_term"; then
    echo -e "${RED}No session found for: $query${NC}"
    return 1
  fi
  local jsonl_file="$REPLY"

  local total_lines
  total_lines=$(wc -l < "$jsonl_file" | tr -d ' ')

  echo -e "${BLUE}Session:${NC} $(basename "$(dirname "$jsonl_file")")"
  echo -e "${DIM}$jsonl_file ($total_lines messages)${NC}"
  echo ""

  render_log_lines "$jsonl_file" "$lines" "$(get_tz_offset_sec)"
}

# ─── Live dashboard ───────────────────────────────────────────────────────────

cmd_watch() {
  local interval="${1:-5}"
  local status_file="$WORKTREE_BASE/orchestrator-status.json"
  local tz_offset
  tz_offset=$(get_tz_offset_sec)

  # Clean exit on Ctrl-C: show cursor, clear to end, print message
  trap 'tput cnorm 2>/dev/null; tput ed 2>/dev/null; echo ""; exit 0' INT TERM

  tput civis 2>/dev/null  # hide cursor during updates

  while true; do
    local buf=""
    local now
    now=$(date +%s)
    local term_lines
    term_lines=$(tput lines 2>/dev/null || echo 40)

    # ── Header ──
    if [ ! -f "$status_file" ]; then
      buf+="${YELLOW}Orchestrator not running${NC}\n"
    else
      local status
      status=$(cat "$status_file" 2>/dev/null) || { buf+="${RED}Error reading status${NC}\n"; }

      if [ -n "${status:-}" ]; then
        local orch_pid started_at last_poll max_workers
        orch_pid=$(echo "$status" | jq -r '.pid')
        started_at=$(echo "$status" | jq -r '.started_at')
        last_poll=$(echo "$status" | jq -r '.last_poll')
        max_workers=$(echo "$status" | jq -r '.max_workers // 5')

        # Orchestrator liveness
        local orch_alive=false
        if [ -n "$orch_pid" ] && kill -0 "$orch_pid" 2>/dev/null; then
          orch_alive=true
        fi

        # Uptime
        local uptime_str="?"
        local start_epoch
        start_epoch=$(TZ=UTC date -jf '%Y-%m-%dT%H:%M:%SZ' "$started_at" '+%s' 2>/dev/null) || \
        start_epoch=$(date -d "$started_at" '+%s' 2>/dev/null) || start_epoch=0
        if [ "$start_epoch" -gt 0 ]; then
          uptime_str=$(format_duration $((now - start_epoch)))
        fi

        # Poll age
        local poll_age_str="?"
        local poll_epoch
        poll_epoch=$(TZ=UTC date -jf '%Y-%m-%dT%H:%M:%SZ' "$last_poll" '+%s' 2>/dev/null) || \
        poll_epoch=$(date -d "$last_poll" '+%s' 2>/dev/null) || poll_epoch=0
        if [ "$poll_epoch" -gt 0 ]; then
          poll_age_str=$(format_duration $((now - poll_epoch)))
        fi

        local worker_count
        worker_count=$(echo "$status" | jq '.workers | length')
        local cb_failures
        cb_failures=$(echo "$status" | jq -r '.circuit_breaker.consecutive_failures')

        if [ "$orch_alive" = true ]; then
          buf+="${GREEN}Orchestrator running${NC} (uptime ${uptime_str}, poll ${poll_age_str} ago) · "
        else
          buf+="${YELLOW}Orchestrator stopped${NC} (last active ${poll_age_str} ago) · "
        fi
        buf+="${worker_count}/${max_workers} workers"
        [ "$cb_failures" -gt 0 ] 2>/dev/null && buf+=" · ${YELLOW}${cb_failures} CB failure(s)${NC}"
        buf+="\n\n"

        # ── Worker table ──
        if [ "$worker_count" -eq 0 ]; then
          buf+="  ${DIM}No active workers${NC}\n"
        else
          buf+="$(printf "  ${DIM}%-9s %-16s %7s %13s  %s${NC}" "ISSUE" "PHASE" "TIME" "PROGRESS" "BRANCH")\n"

          # Compute log lines per worker: fill remaining terminal space
          # Account for: header(2) + blank(1) + table header(1) + worker rows + blank(1) + separator per worker(1)
          local chrome_lines=$(( 5 + worker_count + worker_count ))
          local remaining=$(( term_lines - chrome_lines ))
          local lines_per_worker=$(( remaining / worker_count ))
          [ "$lines_per_worker" -lt 3 ] && lines_per_worker=3
          [ "$lines_per_worker" -gt 12 ] && lines_per_worker=12
          # Fetch more JSONL messages than display lines (some messages produce no output)
          local msgs_per_worker=$(( lines_per_worker * 3 ))

          # Collect per-worker data in a single loop
          local w_issues=() w_pids=() w_branches=() w_logs=() w_phases=() w_elapsed=() w_progress=() w_alive=()
          local i=0
          while [ "$i" -lt "$worker_count" ]; do
            local worker
            worker=$(echo "$status" | jq -c ".workers[$i]")

            w_issues+=("$(echo "$worker" | jq -r '.issue')")
            w_pids+=("$(echo "$worker" | jq -r '.pid')")
            w_branches+=("$(echo "$worker" | jq -r '.branch')")
            w_logs+=("$(echo "$worker" | jq -r '.log_file')")
            local w_started
            w_started=$(echo "$worker" | jq -r '.started_at')

            # Elapsed time
            local w_start_epoch=0
            w_start_epoch=$(TZ=UTC date -jf '%Y-%m-%dT%H:%M:%SZ' "$w_started" '+%s' 2>/dev/null) || \
            w_start_epoch=$(date -d "$w_started" '+%s' 2>/dev/null) || w_start_epoch=0
            if [ "$w_start_epoch" -gt 0 ]; then
              w_elapsed+=("$(format_duration $((now - w_start_epoch)))")
            else
              w_elapsed+=("?")
            fi

            # Git progress + phase detection
            local ahead=0 dirty="" wt_path progress phase
            wt_path=$(get_worktree_path "${w_branches[$i]}")
            if [ -d "$wt_path/.git" ] || [ -f "$wt_path/.git" ]; then
              ahead=$(commits_ahead "$wt_path") || true
              [[ "$ahead" =~ ^[0-9]+$ ]] || ahead=0
              [ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ] && dirty="+"
              progress="${ahead} commit(s)${dirty}"
            else
              progress="setting up"
            fi
            w_progress+=("$progress")

            # Phase detection (from log markers + git heuristics)
            local w_log="${w_logs[$i]}"
            phase=$(wt_detect_phase "$w_log" "$wt_path" "${w_branches[$i]}" "$ahead" "$dirty")
            w_phases+=("$phase")

            # Alive check
            if kill -0 "${w_pids[$i]}" 2>/dev/null; then
              w_alive+=("")
            else
              w_alive+=(" ${RED}(dead)${NC}")
            fi

            i=$((i + 1))
          done

          # Render worker table rows
          i=0
          while [ "$i" -lt "$worker_count" ]; do
            local phase_color="$NC"
            case "${w_phases[$i]}" in
              Initializing) phase_color="$DIM" ;;
              Planning)     phase_color="$BLUE" ;;
              Implementing) phase_color="$GREEN" ;;
              Reviewing)    phase_color="$YELLOW" ;;
              Committing)   phase_color="$BLUE" ;;
              "PR review")  phase_color="$YELLOW" ;;
              Merging)      phase_color="$GREEN" ;;
              Done)         phase_color="$GREEN" ;;
            esac

            buf+="$(printf "  %-9s ${phase_color}%-16s${NC} %7s %13s  %s" \
              "${w_issues[$i]}" "${w_phases[$i]}" "${w_elapsed[$i]}" "${w_progress[$i]}" "${w_branches[$i]}")${w_alive[$i]}\n"
            i=$((i + 1))
          done

          # ── Log tails per worker ──
          buf+="\n"
          local separator_line="──────────────────────────────────────────────────────"
          i=0
          while [ "$i" -lt "$worker_count" ]; do
            buf+="${DIM}─── ${NC}${w_issues[$i]}${DIM} ${separator_line:0:$((50 - ${#w_issues[$i]}))}${NC}\n"

            local search_term
            search_term=$(echo "${w_issues[$i]}" | tr '[:upper:]' '[:lower:]')

            if find_session_jsonl "$search_term"; then
              local log_output
              log_output=$(render_log_lines "$REPLY" "$msgs_per_worker" "$tz_offset" | tail -"$lines_per_worker")
              if [ -n "$log_output" ]; then
                buf+="$log_output\n"
              else
                buf+="  ${DIM}(no activity yet)${NC}\n"
              fi
            else
              buf+="  ${DIM}(no session found)${NC}\n"
            fi

            i=$((i + 1))
          done
        fi
      fi
    fi

    # ── Render ──
    clear
    echo -e "$buf"

    sleep "$interval"
  done
}

# ─── Orchestrator lifecycle ────────────────────────────────────────────────────

cmd_start() {
  local pid_file="$WORKTREE_BASE/orchestrator.pid"
  local log_dir="$WORKTREE_BASE/logs"
  local log_file="$log_dir/orchestrator.log"
  # orchestrator.sh's log() is the sole writer of $log_file. Its stdout/stderr
  # go to a separate console log so crash output (set -e aborts, bash errors,
  # stray tool noise) is still captured without storing every log line twice —
  # once more with raw ANSI escapes (HON-572).
  local console_log="$log_dir/orchestrator-console.log"

  # Check if already running
  if [ -f "$pid_file" ]; then
    local existing_pid
    existing_pid=$(cat "$pid_file" 2>/dev/null) || true
    if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
      echo -e "${YELLOW}Orchestrator already running (PID $existing_pid)${NC}"
      echo "Use 'wt stop' to stop it first, or 'wt status' to check."
      return 1
    fi
  fi

  # .env is loaded by the top-level dispatcher; just validate the orchestrator's
  # required var here.
  if [ -z "${LINEAR_API_KEY:-}" ]; then
    echo -e "${RED}Error: LINEAR_API_KEY not set (check $REPO_ROOT/.env)${NC}"
    return 1
  fi

  mkdir -p "$log_dir"

  # Pass through any extra flags (--max-workers, --once, etc.)
  nohup "$SCRIPT_DIR/orchestrator.sh" "$@" >> "$console_log" 2>&1 &
  local new_pid=$!

  # Brief wait to check it didn't die immediately
  sleep 1
  if kill -0 "$new_pid" 2>/dev/null; then
    echo -e "${GREEN}Orchestrator started (PID $new_pid)${NC}"
    echo -e "${DIM}Log: $log_file${NC}"
    echo -e "${DIM}Console (stdout/stderr): $console_log${NC}"
    echo ""
    echo "Use 'wt watch' for live dashboard, 'wt stop' to stop."
  else
    echo -e "${RED}Orchestrator failed to start. Check logs:${NC}"
    echo -e "${DIM}$log_file${NC}"
    echo -e "${DIM}$console_log${NC}"
    # A start-up abort (bad flag, missing dep) never reaches log(), so the
    # console log is where the reason actually is. Tail both.
    tail -5 "$log_file" 2>/dev/null
    tail -5 "$console_log" 2>/dev/null
    return 1
  fi
}

# How long `wt stop` waits for the force-shutdown drain before SIGKILL, in
# seconds. Pure so it can be asserted without a live orchestrator: max(60,
# 15 * workers). 15s/worker is the drain's own budget (10s wait_for_exit plus
# cleanup and a Linear round-trip); the 60s floor covers a missing, empty or
# unparseable status file, where the count is unknown and guessing low is the
# failure mode that stranded issues in the first place.
stop_wait_bound() {
  local workers="${1:-}"
  local floor=60 per_worker=15

  [[ "$workers" =~ ^[0-9]+$ ]] || workers=0

  local bound=$(( workers * per_worker ))
  [ "$bound" -lt "$floor" ] && bound=$floor
  echo "$bound"
}

cmd_stop() {
  local pid_file="$WORKTREE_BASE/orchestrator.pid"
  local status_file="$WORKTREE_BASE/orchestrator-status.json"

  if [ ! -f "$pid_file" ]; then
    echo -e "${YELLOW}No orchestrator PID file found.${NC}"
    return 1
  fi

  local pid
  pid=$(cat "$pid_file" 2>/dev/null) || true

  if [ -z "$pid" ]; then
    echo -e "${YELLOW}Empty PID file.${NC}"
    rm -f "$pid_file"
    return 1
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    echo -e "${YELLOW}Orchestrator not running (stale PID $pid). Cleaning up.${NC}"
    rm -f "$pid_file"
    return 0
  fi

  echo -e "${BLUE}Stopping orchestrator (PID $pid)...${NC}"
  echo -e "${DIM}Sending SIGTERM (graceful — waits for workers to finish)${NC}"
  kill -TERM "$pid" 2>/dev/null

  # Wait up to 15s for graceful shutdown
  local waited=0
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 15 ]; do
    sleep 1
    waited=$((waited + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    echo -e "${YELLOW}Still running (workers active). Sending second SIGTERM to force kill workers...${NC}"
    kill -TERM "$pid" 2>/dev/null || true

    # The force path runs drain_workers_to_todo, which per worker does
    # kill_process_tree -> wait_for_exit (up to 10s) -> SIGKILL ->
    # cleanup_worker_worktree -> a Linear round-trip. With 3-5 workers that is
    # 30-50s. The old flat `sleep 3` killed the orchestrator mid-drain, orphaning
    # `claude` processes and leaving their issues In Progress + assigned — the
    # exact state select_next_issue skips forever (HON-572). Scale the wait with
    # the work instead.
    local worker_count bound
    worker_count=$(jq -r '.workers | length' "$status_file" 2>/dev/null) || worker_count=""
    bound=$(stop_wait_bound "$worker_count")
    echo -e "${DIM}Draining ${worker_count:-unknown} worker(s) — waiting up to ${bound}s before SIGKILL${NC}"

    local drained=0
    while kill -0 "$pid" 2>/dev/null && [ "$drained" -lt "$bound" ]; do
      sleep 1
      drained=$((drained + 1))
    done
  fi

  if kill -0 "$pid" 2>/dev/null; then
    echo -e "${YELLOW}Drain did not finish in time. Sending SIGKILL...${NC}"
    echo -e "${DIM}Check 'wt list' for orphaned worktrees and Linear for issues left In Progress.${NC}"
    kill -9 "$pid" 2>/dev/null || true
  fi

  echo -e "${GREEN}Orchestrator stopped.${NC}"
}

# ─── .env loading ────────────────────────────────────────────────────────────
# Read KEY=VALUE pairs out of an env file and export them.
#
# Parsed, never sourced. `source` executes the file as shell, so `FOO=$(rm -rf
# ~)` was a working command rather than a parse error, and the `set -a` that
# wrapped it marked every assignment the file made for export, including ones a
# well-formed-line filter rejects (HON-580). Nothing here evaluates the value;
# it is only ever assigned as a literal string.
#
# Precedence is unchanged: .env wins over what the caller already exported.
# Every `wt` subcommand depends on that — `wt auto` patches DATABASE_URL into a
# worktree's own .env copy and needs it to beat the parent shell's.
#
# Otherwise the parse mirrors what `source` did with a well-formed line, since
# that is the behaviour every existing .env was written against: skip comments
# and blanks, split on the FIRST `=`, drop trailing whitespace and a
# whitespace-preceded `#` comment from an unquoted value, and strip one matched
# pair of surrounding quotes (a quoted value keeps its spaces and its `#` —
# that is what the quotes are for). A quoted value left open continues on the
# next line. Keys must be shell identifiers; a malformed line is skipped, not
# fatal, and a missing file is a silent no-op — commands that genuinely require
# a var validate it explicitly (cmd_start validates LINEAR_API_KEY,
# neon_enabled validates NEON_*).
load_env_file() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0

  local line key value quote cont
  # `|| [ -n "$line" ]` so a final line with no trailing newline is still read.
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"                      # tolerate CRLF
    line="${line#"${line%%[![:space:]]*}"}"   # trim leading whitespace
    case "$line" in
      '' | '#'*) continue ;;
      # Both spellings `source` accepted. Matching only a literal `export `
      # would drop a tab-indented line with no diagnostic at all.
      'export '* | $'export\t'*)
        line="${line#export}"
        line="${line#"${line%%[![:space:]]*}"}"
        ;;
    esac

    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue

    # Trim before inspecting quotes, so a value quoted for the sake of a
    # deliberate trailing space still keeps it.
    value="${value%"${value##*[![:space:]]}"}"

    quote=""
    case "$value" in
      '"'*) quote='"' ;;
      "'"*) quote="'" ;;
    esac

    if [ -n "$quote" ]; then
      # An unclosed quote continues onto the next line, as `source` read it.
      # `read` here draws from the same redirect as the loop, so the
      # continuation is consumed rather than re-parsed as its own assignment.
      # Bounded by EOF: an unterminated value simply runs out of lines.
      while [ "${#value}" -lt 2 ] || [ "${value: -1}" != "$quote" ]; do
        IFS= read -r cont || break
        cont="${cont%$'\r'}"
        value="$value"$'\n'"${cont%"${cont##*[![:space:]]}"}"
      done
      # One matched pair only. A quote left unterminated at EOF is kept in the
      # value: better a visibly malformed string than a plausible wrong one.
      if [ "${#value}" -ge 2 ] && [ "${value: -1}" = "$quote" ]; then
        value="${value:1:${#value}-2}"
      fi
    else
      # `source` started a comment at a whitespace-preceded `#`. Requiring the
      # whitespace is what keeps a `#` inside a value (`p@ss#word`) intact.
      case "$value" in
        *[[:space:]]'#'*) value="${value%%[[:space:]]'#'*}" ;;
      esac
      value="${value%"${value##*[![:space:]]}"}"
    fi

    # `|| true` because the script runs under `set -e`: a readonly name in .env
    # would otherwise abort the dispatcher before it reaches the command router.
    export "$key=$value" 2> /dev/null || true
  done < "$env_file"
}

# ─── Entry point ─────────────────────────────────────────────────────────────
# Everything below runs only when this file is EXECUTED. `wt` is a shell alias
# that executes the script, so this is behaviour-neutral for every real caller;
# it exists so scripts/orchestrator-outcome-harness.sh can `source` the file to
# unit-test pure helpers (neon_gc_orphan_names, stop_wait_bound) without the
# dispatcher firing print_usage and exiting, and without .env leaking into the
# test shell.
if [ "${BASH_SOURCE[0]}" != "${0}" ]; then
  return 0
fi

# Make NEON_API_KEY / NEON_PROJECT_ID / LINEAR_API_KEY (and anything else in
# .env) available to every subcommand. See load_env_file for why this parses
# rather than sources.
load_env_file "$REPO_ROOT/.env"

# Main command router
case "${1:-}" in
  start)
    shift
    cmd_start "$@"
    exit $?
    ;;
  stop)
    cmd_stop
    ;;
  new)
    shift
    cmd_new "$@"
    ;;
  auto)
    shift
    cmd_auto "$@"
    ;;
  resume)
    cmd_resume "$2"
    ;;
  list)
    cmd_list
    ;;
  status)
    cmd_status "$2"
    ;;
  logs)
    cmd_logs "$2" "${3:-20}"
    ;;
  watch)
    cmd_watch "${2:-5}"
    ;;
  cleanup)
    cmd_cleanup "$2"
    ;;
  cleanup-all)
    cmd_cleanup_all
    ;;
  neon-delete)
    # Non-interactive Neon-branch delete for external callers (e.g. orchestrator).
    # Same semantics as the cleanup hook: degrades silently if Neon isn't configured,
    # refuses protected names, never fails loud.
    neon_delete_branch_for_worktree "$2"
    ;;
  sync)
    cmd_sync "$2"
    ;;
  sync-all)
    cmd_sync_all
    ;;
  -h|--help|help)
    print_usage
    ;;
  *)
    if [ -n "$1" ]; then
      echo -e "${RED}Unknown command: $1${NC}"
      echo ""
    fi
    print_usage
    exit 1
    ;;
esac
