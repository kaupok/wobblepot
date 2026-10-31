# Judge — `--backtest`

Read from `SKILL.md` when `--backtest` is passed. The run itself is HON-1515; this file is how it runs.

A backtest replays past findings that a human already settled, and counts how often the judge agrees. It writes nothing to the replayed issues.

## The set

1. A 6.8 finding has the body section `## Why it wasn't fixed here`. Refinement stripped the title prefix, so search by that section, not by title: `list_issues({ team: "Wobblebot", query: "Why it wasn't fixed here", includeArchived: true })`, paged until empty. Keep only issues whose description holds that exact heading.
2. Take every `Canceled` and `Duplicate` one, plus 25 `Done` ones picked at random. Pick with a recorded seed, so the set can be rebuilt:
   ```bash
   SEED=<integer> node -e 'let s=+process.env.SEED;const r=()=>(s=(s*1103515245+12345)%2**31)/2**31;const ids=process.argv.slice(1);for(let i=ids.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]]}console.log(ids.slice(0,25).join(" "))' <Done IDs sorted>
   ```
3. Expected outcome: `Done` → real. `Canceled` → won't fix. `Duplicate` → sent back.

## The corpus as of each issue

The later fix often changed the docs, so today's docs leak the answer. Judge each issue against the repository and Linear as they were when it was filed.

- **Repository:** `SHA=$(git rev-list -1 --before=<createdAt> origin/main)`. The subagent reads with `git show $SHA:<path>` and `git grep <term> $SHA -- <paths>`, never the working tree or `origin/main`. Put `$SHA` in the prompt everywhere `verdict.md` says `origin/main`.
- **Linear:** drop every search result created after the issue's `createdAt`. The subagent gets the issue's title, description and labels from the main session, in the prompt. It does not call `get_issue` or `list_comments` on the replayed issue, so it never sees the state or the comments that settled it.
- **Corrections:** none. Step 3 corrections came later than the replayed issues.
- **Gates:** run step 2 on the issue as filed. A gated issue counts as held.

## The run

Per issue: steps 2, 4 and 5 of `SKILL.md`, with these changes.

- Finalize against the issue's commit: `pnpm --silent judge finalize --verdict <file> --ref $SHA --linear-dir <dir>`. Fetch only cited Linear issues created before the replayed issue, and keep only comments dated before it. Write `Status:` as the cited issue's state at the replayed issue's `createdAt` (from `get_issue` `stateHistory`), not its state today: the target of a past duplicate is usually Done by now, and today's state would hold every correct duplicate verdict.
- **Skip step 6.** No comment and no label on a replayed issue, and nothing on any other issue except the HON-1515 report.
- Keep each finalized verdict in `$SCRATCH/<ID>/` until the report is posted.

## The report

One comment on the backtest issue:

- the seed and the set size per expected outcome;
- a confusion matrix, expected (rows: real, won't fix, sent back) by verdict (columns: real, won't fix, sent back, held), over every issue in the set;
- the Hold rate;
- one line per wrong verdict: issue, expected, got, cited source;
- the gate result. Pass means "real" on at most 1 Canceled issue, and "real" on at least 80% of Done issues.

Raw accuracy is a weak measure here: most past findings were Done, so a judge that always says "real" scores about 90%. The Canceled row is the one that counts. When the gate fails, file an issue that names the pattern behind the wrong verdicts: a missing doc section, a bad gate keyword, or a weak citation rule.
