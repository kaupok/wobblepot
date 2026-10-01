# Auto-implement — batched plans and long verification (3.3)

Read from `SKILL.md` → 3.3 when the plan splits the work into batches, or when a verification will outrun Bash's 600 s foreground cap.

When the plan splits the work into sequential batches (dependency refreshes, migration series, multi-step refactors), do NOT defer all commits to Phase 5:

- Commit each batch as soon as its fast gate passes (`pnpm lint && pnpm type-check && pnpm test`, plus `pnpm build` when the plan calls for it), following the Phase 5.1/5.2 staging and message conventions.
- Push after the first batch commit (`git push -u origin $(git branch --show-current)`) and after each subsequent one. Phase 5 then skips straight to PR creation (5.3) for what is already pushed.
- Long-running verification (`pnpm test:e2e:local`, large `pnpm test-storybook:ci` runs) executes AFTER the batch's commit is pushed. Such a run outlives Bash's 600 s foreground cap, so start it with `run_in_background: true` as one self-contained command that writes its terminal marker to a file, then **wait on that file in the same turn** with foreground wait-chunks — the Phase 6.1 pattern, applied to a marker file instead of `gh pr checks`:

  ```bash
  # Start (run_in_background: true) — the marker file is the only handoff.
  rm -f /tmp/batch-verify.done
  { pnpm test:e2e:local && echo E2E_PASS || echo E2E_FAIL; } > /tmp/batch-verify.log 2>&1
  tail -1 /tmp/batch-verify.log > /tmp/batch-verify.done
  ```

  ```bash
  # Wait (FOREGROUND, timeout: 540000) — re-issue while it prints VERIFY_WAITING.
  for i in $(seq 1 32); do
    if [ -s /tmp/batch-verify.done ]; then cat /tmp/batch-verify.done; exit 0; fi
    sleep 15
  done
  echo VERIFY_WAITING
  ```

  `E2E_PASS` → continue. `E2E_FAIL` → read `/tmp/batch-verify.log` and fix forward with a follow-up commit in the same batch — never rewrite a pushed batch commit. `VERIFY_WAITING` → re-issue the wait; do not end the turn on it. Do not start the next batch until the verification result is in.

**Why:** a batch commit gated on long verification is a batch that can be lost. The orchestrator deletes the worktree and local branch on every worker exit and gates clean 0-commit exits (HON-562, 2026-08-30: batch 1 was fully green but uncommitted while E2E was still seeding; the worker's turn ended, the process exited, and everything was discarded). Pushed commits are the only state that survives a worker death — and the foreground wait is what keeps the process alive long enough to act on the result (HON-573).

Committing and pushing each batch is what makes a process death survivable, but it is not a licence to end the turn early: the Execution Model rule in `SKILL.md` still applies.
