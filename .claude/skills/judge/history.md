# Judge — why each rule exists

Read when you change or dispute a rule in `SKILL.md`. Not needed for a run.

## Source

Jacob (Spawn), "How I Built the Most AI-Pilled Company in the World", 2026-10-29, <https://x.com/jsnnsa/status/2115623382721126826>. Spawn's judges answered 7,296 of 11,372 questions from recorded decisions; the founder answered 27. The rest were held for a human. The lesson taken here: most questions an agent raises already have an answer in what the team decided before, and a judge that quotes that answer saves the human from reading the question cold.

## The problem here (HON-1514)

`/auto-implement` 6.8 files each deferred review finding as an `[AUTO DRAFT]` issue, and only a human clears that prefix, in `/refine-backlog --auto-drafts`. The human is the limit on how many issues get refined, and HON-1299 plans ticket sources that will file many more drafts.

## Rules

- **One comment and one label; no other write.** A wrong verdict costs nothing until a human acts on it. Write access widens only after the live sample in HON-1516 passes; the widening itself is HON-1517.
- **Hold is a full verdict.** Spawn's judges held about a third of questions. A judge that stretches a weak precedent into a Decide trains the human to stop reading the citations.
- **Hard gates before any model call.** GTM, legal, money, AI spend, irreversible changes, auth and allergens are areas the user keeps. A gate checked after the model reads the issue can be argued around; a script check before it cannot. The script reads `gates.md` so the prose and the matcher do not drift.
- **The script checks every quote.** A judge that invents a precedent is worse than no judge, because the human trusts the citation. The quote must be verbatim in the file at the judged commit, or in Linear text the main session fetched itself. The subagent never supplies the text its own quote is checked against.
- **A quote from a doc or an issue has at least 5 words, and a Decide needs one.** A one-word quote ("test") is in almost every file, so it proves nothing. Code shows what the software does, not what the team decided, so a code quote alone never carries a Decide.
- **Earlier verdicts are never precedent.** The script removes `## Judge:` comments from fetched Linear text. Otherwise one model verdict becomes the citation for the next, with no human between them.
- **Every Send back that closes the finding needs proof.** `/refine-backlog` recommends cancelling a stale or misread finding and closing a duplicate into its target, so these need a verified quote, and a duplicate's target must be open.
- **`git show` and not `git grep -F`.** `git grep -F` treats each line of a two-line quote as a separate pattern and matches either one, so a quote whose second line is invented would pass.
- **Doc citations name a heading, not a line.** Doc lines drift with every edit; a heading path still finds the text a month later.
- **A Canceled state alone is not a decision.** Many Canceled issues have no comment that says why. Only a stated reason is a precedent.
- **One fresh subagent per issue.** The main context keeps only verdicts, and no verdict depends on what the session read for the previous issue. The same pattern as `/bench-judge`.
- **Corrections feed every run, and `--fold` retires them.** An overrule is a decision nobody recorded. Passing the 30 newest stops the judge repeating a mistake; folding them into the docs makes them a precedent any session can cite, and keeps the list short.
- **The backtest uses the corpus as of filing.** The fix that closed a past finding often changed the docs, so judging it against today's docs leaks the answer.
