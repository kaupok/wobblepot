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
# A branch is dead when, with the gate E2E_GC_MIN_AGE_HOURS (default 2):
#   - its <host> is this host's tag and no process <pid> runs e2e-local.sh, at
#     any age. A pid that another program now holds counts as dead; a ps that
#     cannot run keeps the branch;
#   - it has the old `e2e-local-<date>-<time>-<pid>` name and its created_at is
#     at least the gate's hours ago. Not updated_at: Neon moves that on compute
#     activity, so a dead branch looks young;
#   - otherwise (another host's run, or a `--keep` branch renamed to
#     `e2e-local-kept-…`) both created_at and updated_at are at least the gate's
#     hours ago. No pid can be checked, so a branch still in use stays.
# A timestamp that does not parse keeps the branch.

E2E_LOCAL_BRANCH_PREFIX="e2e-local"

# Portable ISO-8601 → unix epoch (BSD date on macOS, GNU date on Linux); 0 when
# it does not parse. The shape is checked first, because GNU date reads "" as
# today's midnight and takes free text such as "yesterday".
e2e_iso_to_epoch() {
  local ts="${1%.*Z}"; ts="${ts%Z}"
  [[ "$ts" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$ ]] || { echo 0; return; }
  date -u -d "$ts" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%S' "$ts" +%s 2>/dev/null || echo 0
}

# This host's tag in a branch name: 6 characters of `hostname -s` (lower-case,
# [a-z0-9] only, so the name splits on `-`) and a 6-digit machine id, made once
# in ~/.config/wobblepot/e2e-host-id. A name alone is not unique: two Macs called
# MacBook-Pro would each delete the other's live branch through the pid rule. A
# missing id only makes this host's branches look foreign, which keeps them.
e2e_local_host_tag() {
  local host id="" file="${HOME:-}/.config/wobblepot/e2e-host-id"
  host="$(hostname -s 2>/dev/null | LC_ALL=C tr '[:upper:]' '[:lower:]' | LC_ALL=C tr -cd 'a-z0-9' || true)"
  if [ -n "${HOME:-}" ]; then
    [ -s "$file" ] || { mkdir -p "${file%/*}" && printf '%06d\n' $(( (RANDOM * 32768 + RANDOM) % 1000000 )) > "$file"; } 2>/dev/null || true
    id="$(LC_ALL=C tr -cd '0-9' 2>/dev/null < "$file" || true)"
  fi
  [[ "$id" =~ ^[0-9]{6}$ ]] || id="$(printf '%06d' $(( (RANDOM * 32768 + RANDOM) % 1000000 )))"
  echo "${host:0:6}${id}"
}

# True when ISO-8601 time $1 parses and is at least $2 hours ago.
e2e_older_than() {
  local epoch
  epoch="$(e2e_iso_to_epoch "$1")"
  [ "$epoch" -gt 0 ] && [ $(( ($(date -u +%s) - epoch) / 3600 )) -ge "$2" ]
}

# Exit 0 when branch $1 is dead. $2 is its created_at, $3 its updated_at, $4
# the gate in hours.
e2e_local_branch_dead() {
  local rest="${1#"$E2E_LOCAL_BRANCH_PREFIX"-}" created="$2" updated="$3" min_age="${4:-2}" host pid cmd
  if [[ "$rest" =~ ^([a-z0-9]+)-[0-9]{8}-[0-9]{6}-([0-9]+)$ ]]; then
    host="${BASH_REMATCH[1]}"; pid="${BASH_REMATCH[2]}"
    if [ "$host" = "$(e2e_local_host_tag)" ]; then
      # Captured, not piped into `grep -q`: under pipefail an early grep exit
      # can fail ps with SIGPIPE, and a live run would read as dead.
      cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
      # A ps that cannot see this shell cannot prove the pid gone: keep it.
      [ -n "$(ps -p "$$" -o command= 2>/dev/null || true)" ] || return 1
      case "$cmd" in *e2e-local.sh*) return 1 ;; *) return 0 ;; esac
    fi
  elif [[ "$rest" =~ ^[0-9]{8}-[0-9]{6}-[0-9]+$ ]]; then
    e2e_older_than "$created" "$min_age"
    return
  fi
  e2e_older_than "$created" "$min_age" && e2e_older_than "$updated" "$min_age"
}

# Print the dead `e2e-local-*` branches in a `neonctl branches list` JSON ($1),
# one name per line; $2 is the gate in hours. Each branch kept goes to stderr.
# Shape-tolerant: accepts either `[...]` or `{"branches": [...]}`.
e2e_local_dead_branch_names() {
  local list="$1" min_age="${2:-2}" name created updated
  # `|`, not a tab: read collapses adjacent whitespace separators, so an empty
  # created_at would shift updated_at into its place.
  while IFS='|' read -r name created updated; do
    [ -n "$name" ] || continue
    if e2e_local_branch_dead "$name" "$created" "$updated" "$min_age"; then
      echo "$name"
    else
      echo "GC: keeping '$name' (its run is live, or it is under ${min_age}h old or idle)" >&2
    fi
  done < <(echo "$list" | jq -r --arg prefix "$E2E_LOCAL_BRANCH_PREFIX-" '
      if type == "array" then .[] elif .branches then .branches[] else empty end
      | select(.name | startswith($prefix))
      | [.name, (.created_at // ""), (.updated_at // "")] | join("|")' 2>/dev/null || true)
}
