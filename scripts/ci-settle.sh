#!/bin/bash
# CI-settle poll: one chunk of the wait that decides when a PR may merge.
#
# Usage:
#   ./scripts/ci-settle.sh <PR_NUMBER>
#
# One chunk = 16 polls, 15 sleeps × 30 s ≈ 480 s of sleep (510 s on chunk 1,
# which also waits for GitHub to register the run) plus ~18 gh calls — under a
# caller's 540 s Bash timeout with room to spare. The 16th sleep is skipped on
# purpose: it would only delay CI_WAITING, and it is what used to push chunk 1
# past the cap, where the call is killed and prints no marker at all.
#
# Prints exactly one marker, on its last line:
#   CI_SETTLED  → terminal (exit 0) — run the caller's verification
#   CI_WAITING  → NOT terminal (exit 0) — re-issue this command (budget: 6 chunks
#                 ≈ 48 min, which covers ci.yml's timeout-minutes of 45)
#   CI_TIMEOUT  → terminal (exit 1) — report and stop
# The caller reads the marker, not the exit code. Pass/fail is decided by the
# caller's verification, not here.
#
# Settles only when: the ci.yml job "Lint, Type Check & Test" is present and none is
# pending, and the sorted name=bucket list is identical on two consecutive polls (fast
# Vercel/smoke statuses register before the ci.yml job does). The job is required on
# every PR, docs-only ones included: ci.yml has no path filter and the job is a required
# status check on main (HON-584), so GitHub refuses a merge before it reports. A poll
# that settled without it, on an empty list before the run registered, would end in a
# refused `gh pr merge` and a stranded PR (HON-1184).
#
# The previous poll's result and the chunk count are carried across invocations in
# files keyed on the PR number, because each caller's Bash call is a fresh shell.
#
# Tested by scripts/ci-settle-gate.test.ts. The exemption filter below must stay
# byte-identical to the one in pr_ci_state() in scripts/orchestrator.sh.

# No pipefail: `printf | grep -q` below would turn a match into 141 whenever grep
# exits before printf has written (HON-1005), and a failed `gh` call must read as
# "not settled yet", not end the chunk without a marker.
set -u

if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo "Usage: $0 <PR_NUMBER>" >&2
  exit 2
fi
PR_NUMBER="$1"

PREV_FILE="/tmp/ci-poll-$PR_NUMBER.prev"; CHUNK_FILE="/tmp/ci-poll-$PR_NUMBER.chunks"
# Reap state left by an abandoned episode (a killed call, a worker timeout).
# It is keyed only by PR number, so a RETRY worker on the same PR would inherit
# the spent budget — 2 chunks instead of 6 — and hit CI_TIMEOUT on CI that was
# always going to take 30 min, re-stranding the PR through the state file. A
# stale PREV is worse: it can match the first CUR and settle the poll without
# ever running the two-consecutive-poll stability check. A live episode
# re-issues within seconds, so age separates the two cleanly.
[ -n "$(find "$CHUNK_FILE" -mmin +10 2>/dev/null)" ] && rm -f "$PREV_FILE" "$CHUNK_FILE"
CHUNKS=$(( $(cat "$CHUNK_FILE" 2>/dev/null || echo 0) + 1 )); echo "$CHUNKS" > "$CHUNK_FILE"
# INIT is a sentinel no check list can equal, so the first poll of an episode can
# never count as stable on its own.
PREV=$(cat "$PREV_FILE" 2>/dev/null || echo INIT)
[ "$CHUNKS" = 1 ] && sleep 30  # let GitHub register the workflow run for the pushed commit
for i in $(seq 1 16); do
  # A third-party commit status (empty workflow — Vercel) is exempt while pending:
  # it can stick after the deploy is Ready (HON-600). A fail still blocks: CI runs
  # no `next build`, so Vercel is the only build gate.
  CUR=$(gh pr checks "$PR_NUMBER" --json name,bucket,workflow \
    --jq 'sort_by(.name) | .[] | select(.workflow != "" or .bucket != "pending") | "\(.name)=\(.bucket)"' 2>/dev/null)
  OK=1
  printf '%s\n' "$CUR" | grep -q '^Lint, Type Check' || OK=0   # ci.yml job registered (every PR)
  printf '%s\n' "$CUR" | grep -q '=pending$' && OK=0           # none pending
  [ "$CUR" = "$PREV" ] || OK=0                                 # identical to the previous poll
  PREV=$CUR; printf '%s' "$CUR" > "$PREV_FILE"
  if [ "$OK" = 1 ]; then rm -f "$PREV_FILE" "$CHUNK_FILE"; echo CI_SETTLED; exit 0; fi
  [ "$i" -lt 16 ] && sleep 30   # the 16th sleep would only delay CI_WAITING
done
if [ "$CHUNKS" -ge 6 ]; then rm -f "$PREV_FILE" "$CHUNK_FILE"; echo CI_TIMEOUT; exit 1; fi
echo "CI_WAITING (chunk $CHUNKS/6)"
