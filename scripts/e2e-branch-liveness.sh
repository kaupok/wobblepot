# shellcheck shell=bash
# Sourced by scripts/e2e-local.sh and scripts/worktree-claude.sh, never run on
# its own. The one rule for when an `e2e-local-*` Neon branch is dead (HON-1415).
#
# `pnpm review:local` and `pnpm test:e2e:local` name their branch
# `e2e-local-<host>-<UTC date>-<UTC time>-<pid>`. A run that dies without its
# EXIT trap (a crash, a closed terminal) leaves the branch, and it holds a slot
# under the Neon branch cap until something deletes it. Two sweeps use this rule:
# `pnpm test:e2e:local gc` (gc_orphans) and the cap sweep of `wt auto`
# (neon_gc_orphan_names), so they cannot drift apart.
#
# A branch is dead when:
#   - its <host> is this host and no process <pid> runs e2e-local.sh, at any
#     age. A pid that another program now holds counts as dead;
#   - otherwise (another host, or the old `e2e-local-<date>-<time>-<pid>` name)
#     its created_at is at least the gate's hours ago (E2E_GC_MIN_AGE_HOURS,
#     default 2). Not updated_at: Neon moves that on compute activity, so a dead
#     branch looks young. A created_at that does not parse keeps the branch.

E2E_LOCAL_BRANCH_PREFIX="e2e-local"

# Portable ISO-8601 → unix epoch (BSD date on macOS, GNU date on Linux); 0 when
# it does not parse.
e2e_iso_to_epoch() {
  local ts="${1%.*Z}"; ts="${ts%Z}"
  date -u -d "$ts" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%S' "$ts" +%s 2>/dev/null || echo 0
}

# This host's tag in a branch name: `hostname -s`, lower-case, [a-z0-9] only
# (no `-`, so the name splits into its fields), at most 12 characters.
e2e_local_host_tag() {
  local tag
  tag="$(hostname -s 2>/dev/null | LC_ALL=C tr '[:upper:]' '[:lower:]' | LC_ALL=C tr -cd 'a-z0-9' || true)"
  tag="${tag:0:12}"
  echo "${tag:-host}"
}

# Exit 0 when branch $1 is dead. $2 is its created_at, $3 the gate in hours.
e2e_local_branch_dead() {
  local name="$1" created="$2" min_age="${3:-2}" host pid cmd epoch
  if [[ "${name#"$E2E_LOCAL_BRANCH_PREFIX"-}" =~ ^([a-z0-9]+)-[0-9]{8}-[0-9]{6}-([0-9]+)$ ]]; then
    host="${BASH_REMATCH[1]}"; pid="${BASH_REMATCH[2]}"
    if [ "$host" = "$(e2e_local_host_tag)" ]; then
      # Captured, not piped into `grep -q`: under pipefail an early grep exit
      # can fail ps with SIGPIPE, and a live run would read as dead.
      cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
      case "$cmd" in *e2e-local.sh*) return 1 ;; *) return 0 ;; esac
    fi
  fi
  epoch="$(e2e_iso_to_epoch "$created")"
  [ "$epoch" -gt 0 ] || return 1
  [ $(( ($(date -u +%s) - epoch) / 3600 )) -ge "$min_age" ]
}

# Print the dead `e2e-local-*` branches in a `neonctl branches list` JSON ($1),
# one name per line; $2 is the gate in hours. Each branch kept goes to stderr.
# Shape-tolerant: accepts either `[...]` or `{"branches": [...]}`.
e2e_local_dead_branch_names() {
  local list="$1" min_age="${2:-2}" name created
  while IFS=$'\t' read -r name created; do
    [ -n "$name" ] || continue
    if e2e_local_branch_dead "$name" "$created" "$min_age"; then
      echo "$name"
    else
      echo "GC: keeping '$name' (its run is live, or it is under ${min_age}h old)" >&2
    fi
  done < <(echo "$list" | jq -r --arg prefix "$E2E_LOCAL_BRANCH_PREFIX-" '
      if type == "array" then .[] elif .branches then .branches[] else empty end
      | select(.name | startswith($prefix))
      | [.name, (.created_at // "")] | @tsv' 2>/dev/null || true)
}
