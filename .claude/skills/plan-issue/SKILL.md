---
name: plan-issue
description: Create an implementation plan for a Linear issue. Explores codebase, writes plan, posts to Linear after approval.
argument-hint: 'HON-XX'
context: inherit
---

# Plan Issue

Create a comprehensive implementation plan for a Linear issue.

## Prerequisites

Requires an issue ID as argument (e.g., `/plan-issue HON-51`).

Supports optional `--auto` flag to skip approval prompt (used by `/auto-implement`).

## Workflow

### 1. Parse arguments

Extract issue ID and flags from arguments:

- Issue ID: `HON-XX` or just `XX` (required)
- `--auto`: Skip approval prompt and post directly

If no issue ID provided, inform the user:

```
Usage: /plan-issue HON-XX [--auto]
Example: /plan-issue HON-51
```

### 2. Fetch issue details

```
mcp__linear-server__get_issue({ id: "HON-XX", includeRelations: true })
```

Extract and note:

- Issue UUID (for the `list_comments` call in step 5)
- Title and description
- `gitBranchName` for later use
- Current assignee (decides whether step 11 may claim the issue)
- `blockedBy` relations (check if blocked)
- `blocks` relations (what this unblocks)
- `relatedTo` / `parentId` (for overlap check in step 3)
- Any labels or priority

**If issue is blocked:** Warn the user and list the blocking issues. Ask if they want to proceed anyway or work on the blockers first.

### 3. Check relatedTo + epic siblings for recently-merged overlap

**Why:** When an issue is part of an epic (has `parentId`) or has `relatedTo` links, a sibling issue may have already landed and introduced files, conventions, schema, or constants that your plan needs to build on rather than duplicate. `blockedBy` is checked above; `relatedTo` and epic-siblings are not — a Done sibling in the same epic is a strong "check for overlap" signal.

Before doing anything else, sync with origin so the overlap check sees the current main:

```bash
git fetch origin main
```

For each id in `relations.relatedTo` and (if `parentId` is set) each sub-issue of the parent:

```
mcp__linear-server__get_issue({ id: "HON-YY", includeRelations: true })
```

For any sibling where `status` ∈ { `Done`, `In Review`, `In Progress` }:

- Note its title, `gitBranchName`, and completion/start time.
- If status is `Done` AND `completedAt` is within the last 14 days, fetch the merged PR to see what files it touched:
  ```bash
  gh pr list --search "HON-YY in:title" --state merged --json number,title,files,mergedAt --limit 1
  ```
  Inspect the `files` array. If any overlap with files you expect to modify (schema, shared lib, route files), flag it in the plan's **Design Decisions** and adjust the approach (extend rather than duplicate).
- If status is `In Progress` / `In Review`, surface it as a coordination risk in the plan's context.

Report the finding to the user inline before continuing so they can redirect if the overlap changes scope:

```
[plan-issue] Sibling check: HON-YY (Done, merged PR #<N> <date>) touches <files> — plan will extend, not duplicate.
```

If no siblings match, log one line and continue:

```
[plan-issue] Sibling check: no recently-merged/in-flight related issues.
```

### 4. Read project context

```
Read docs/PROJECT_SPEC.md
```

Note the current phase and any relevant architectural decisions.

### 5. Fetch issue comments

```
mcp__linear-server__list_comments({ issueId: "issue-uuid" })
```

Review any prior discussion, decisions, or context from team members.

### 6. Explore codebase

Using Read, Grep, and Glob tools:

- Identify key files mentioned in the issue
- Find existing patterns to follow
- Note related components or APIs

Focus on files directly relevant to the issue (2-5 files max).

**If step 3 flagged any recently-merged sibling issues:** also run `git log --oneline --since="14 days ago" -- <overlapping-paths>` and `git diff origin/main~<N>..origin/main -- <overlapping-paths>` so you actually see what the sibling changed. The file tree alone doesn't tell you which lines are new; without the diff you risk searching for a pattern, not finding it, and duplicating it.

### 7. Scan for downstream impact

Two mechanical scans over the file set from step 6, for the two ways a change breaks code the plan never names: **7a** — specs that assert on a route or copy you are changing; **7b** — callsites that hardcode a copy of a shared primitive's geometry. They are independent: run each one whose trigger list matches, skip the ones that don't, and go to step 8 when both are settled. Both are cheap greps, and both are cheaper here than in review.

#### 7a. E2E impact

**Why:** When a plan touches a route, renames user-visible copy, or restructures a modal/dialog, one or more `tests/e2e/*.spec.ts` files are almost always affected. Historically (see HON-518) these updates lagged the UI change by months and surfaced as an unrecoverable batch when CI came back online. Catching the impact at planning time is the cheapest place to fix it — the plan can list the specs explicitly and the implementation step ships UI + spec updates in one PR.

This scan runs **after** codebase exploration (step 6) so the file set is real — not a mental sketch. If step 6 turned up no touched `src/app/**/page.tsx`, navigation callsite, visible-copy string, or modal restructure, skip 7a and go to 7b.

**Run 7a if step 6 surfaced changes to any of:**

- `src/app/**/page.tsx` (route added, removed, or renamed)
- A URL path in user-facing navigation (`<Link>` / `router.push` callsites)
- Copy in a visible heading, button, link, or modal title
- The structure of a `Dialog` / `AlertDialog` / navigation dropdown

**How:**

1. From the files identified in step 6, extract the routes (pathnames each `page.tsx` represents) and component names.
2. Grep the spec headers for matches:
   ```bash
   grep -l "ROUTES.*<path>\|COMPONENTS.*<Component>" tests/e2e/*.spec.ts
   ```
3. For each matching spec, read the relevant assertions and decide whether the plan's change breaks the selector or copy the spec asserts.

Record findings under a new "E2E updates required" section of the plan (step 8). If the scan ran and found no matching specs (e.g. a brand-new route with no existing coverage, or a modal whose assertions live elsewhere), still note "E2E updates required: none — no existing spec asserts on the changed routes/components" so the reviewer sees the scan happened.

#### 7b. Shared-primitive coupling

**Why:** Changing a shared primitive's geometry breaks everything that hardcoded a copy of it, and those copies are invisible from the primitive's own file. HON-612 (PR #704) raised `Button` / `Input` / `Select` to 44px on mobile; 12 route-level `loading.tsx` skeletons had been sized to mirror the old 36px controls, so each one silently desynced into a visible layout jump at hydration. The issue's own step list named 9 composites to sweep and none of the skeletons, so review round 2 caught it instead — and an extra review round costs more wall clock than the whole implementation did. The scan below is four greps run from a cold start; they narrow "everything in `src`" to a list short enough to read and bucket by hand.

**Run 7b if step 6 surfaced changes to any of:**

- A size, height, padding, or radius default in a CVA variant under `src/components/ui/*.tsx`
- A `@theme` token in `src/app/globals.css` that a primitive consumes
- A default in a shared layout wrapper (container width, page padding)

**How:** for each changed primitive, take the **old** literal class value it is moving away from — the one callsites would have copied — and find every hardcoded copy. Substitute it for `h-9` / `size-9` below.

```bash
# 1. Skeletons that mirror control geometry — matched by shape, not by location.
grep -rn '<Skeleton' src --include='*.tsx' \
  | grep -E '\b(min-h|h|size)-(7|8|9|10|11|12|14|touch)\b' \
  | grep -v -e '\.stories\.' -e '\.test\.'

# 2. Every hardcoded copy of the old value. Exclude only the primitive file(s)
#    you are actually changing — never all of src/components/ui/.
grep -rn '\bh-9\b\|\bsize-9\b' src --include='*.tsx' \
  | grep -v -e '\.stories\.' -e '\.test\.' -e 'src/components/ui/button.tsx'

# 3. className height overrides on the primitives being changed. The tag is often
#    several lines above the className, so match a window, not a line.
grep -rn -A6 '<Button\b\|<Input\b\|<SelectTrigger\b' src --include='*.tsx' \
  | grep -E 'className="[^"]*\b(min-h|h|size)-(5|6|7|8|9|10|11|12|14|touch)\b' \
  | grep -v -e '\.stories\.' -e '\.test\.'

# 4. Variant-prop overrides. Run this one only when the change alters the gap
#    between the default and another size — see below.
grep -rn -A6 '<Button\b\|<Input\b\|<SelectTrigger\b' src --include='*.tsx' \
  | grep -E 'size="(sm|lg|icon-sm|icon-lg)"' \
  | grep -v -e '\.stories\.' -e '\.test\.'
```

Each of the four is shaped by a way the obvious version misses something, all of it found by replaying against the pre-HON-612 tree and diffing against what PR #704 actually had to change:

- **Grep 1 matches shape, not location.** Scoping to `--include='loading.tsx'` looks right — route skeletons are the bulk — but inline skeletons mirror controls too, and HON-612 had to change `recipes/imagine/ImagineClient.tsx:47` (`h-10` → `h-touch md:h-9`) inside a local `SkeletonCard()`. Location-scoping misses it, and so does grep 2, which only knows the old literal `h-9`. `AlternativesList.tsx:28` is the same shape and _is_ found — but only because it happened to use exactly `h-9`. Shape-matching removes that coincidence, at the cost of ~70 lines to bucket instead of 15 filenames.
- **Grep 2's exclusion must name files, not the directory.** `-e 'src/components/ui/'` drops the sibling primitives that share the old value — pre-HON-612 that is exactly `button.tsx`, `input.tsx`, and `select.tsx`, all on `h-9`. They are the highest-value hits in the scan, not noise: HON-612's commit message is "all three move together because they share the old `h-9`; raising one alone misaligns every form row that puts a button beside a field." Exclude the file you are editing and let the siblings surface.
- **Grep 3 needs the window and every primitive.** grep is line-based, so a single-line `<Button[^>]*className=` cannot reach a `className` Prettier wrapped onto a later line — `CreateHouseholdForm.tsx` puts its `className` six lines below the `<Button`. And `FillDaysAction.tsx:112` pins its height on a `SelectTrigger`, which a `Button`-only pattern never sees. Together those cost real recall: the single-line `Button`-only form returned 1 of the 3 files needing re-check; the form above returns all 3.
- **Grep 4 catches the override that has no `className`.** Run it when the change moves the default relative to another size variant. HON-612 did exactly that — the default went to 44px while `sm` stayed at 32px, widening the gap from 4px to 12px — which silently re-prices every `size="sm"` callsite, and HON-612 had to drop `size="sm"` from `LowConfidenceIngredientRow.tsx:162` so the button would take the new default. No `className`, so grep 3 cannot match it by construction. It is a separate grep because it is high-volume (57 lines across 31 files pre-HON-612): scan it for callsites whose _reason_ for being `sm` no longer holds, and record only those, not the whole list.

Grep 3's size allowlist skips `h-3`/`h-4` icons while keeping genuine small overrides (`MealCard` pins its actions at `h-5`). A few `h-5 w-5` icon lines still come through — expected noise, drop them on sight. Note that `-A` marks context lines `file-123-` and match lines `file:123:`; both are real hits, and the coordinate is the number either way.

Classify every surviving hit into one of three buckets, because they need different treatment:

| Bucket                                                                     | Treatment                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mirror** — a skeleton or sibling sized to match the primitive            | Must change with the primitive, or it desyncs                                                                                                                                                                                       |
| **Override** — a `className` or a `size` prop that pins a different height | Must be re-checked: with a responsive variant a `className` may now apply on mobile only (see `docs/DESIGN.md` → "Spacing, radius, elevation"), and a `size` prop that was chosen for the old default may no longer fit the new one |
| **Deliberate** — a different size chosen on purpose                        | Leave it, and say why in the plan so review does not re-raise it                                                                                                                                                                    |

The bucket is not readable off the class name. The same `h-9` in a skeleton can mirror a control (Mirror), a `Heading` line height (`h2` → `text-3xl` → `h-9` — `admin/signup-codes/loading.tsx:3-6` documents exactly this), or a list row; only the first must move with the primitive. The sibling classes are the tell: `rounded-md` is control geometry, `rounded-lg` is a list row, a bare `w-48` is a heading. HON-612 rightly changed 12 of the 15 skeleton files and left three alone on that basis. Read the surrounding markup before assigning a bucket.

Record the result under a new "Coupled callsites" section of the plan (step 8), grouped by bucket, with a `file:line` and a one-line reason each. If the scan ran and found nothing, write `none — no callsite hardcodes the changed geometry` so the reviewer sees the scan happened. Omit the section entirely only when 7b was skipped.

### 8. Write plan and present to user

Write the plan directly in your response (not to a file). Use this structure:

```markdown
# Plan: HON-XX - [Issue Title]

**Issue:** HON-XX
**Branch:** `[gitBranchName from Linear]`

## Context

[2-3 sentence summary of the issue and relevant background]

## Design Decisions

| Decision       | Choice        | Rationale |
| -------------- | ------------- | --------- |
| [Key decision] | [Your choice] | [Why]     |

## Files to Create

- `src/path/to/new/file.tsx` - [Purpose]

## Files to Modify

- `src/path/to/existing/file.ts` - [What changes]

## Implementation Steps

1. [Specific step with details]
2. [Specific step with details]
3. [Specific step with details]

## Tests

- `src/path/to/file.test.ts` - [What to test]

## E2E updates required

[From step 7a. Either list the affected specs with a one-line reason each, or — if the scan ran and found no matching specs — write `none — no existing spec asserts on the changed routes/components` so the reviewer sees the scan happened. Omit this section entirely only if 7a was skipped (step 6 surfaced no route / navigation / visible-copy / modal changes).]

## Coupled callsites

[From step 7b. Group by Mirror / Override / Deliberate with a `file:line` each and a one-line reason. If the scan ran and found nothing, write `none — no callsite hardcodes the changed geometry`. Omit this section entirely only if 7b was skipped (step 6 surfaced no shared-primitive geometry change).]

## Storybook stories

[If any file under `src/components/**` is created or modified, list the colocated `.stories.tsx` files to create/update (CLAUDE.md Storybook rule). Otherwise write `none — no component changes`.]

## Verification

- [ ] [How to test the implementation]
- [ ] [What to verify works correctly]
- [ ] [Edge cases to check]
```

### 9. Get approval (or skip if --auto)

**If `--auto` flag is present:** Skip approval and proceed directly to step 10.

**Otherwise:** Use `AskUserQuestion` to confirm the plan:

```
AskUserQuestion({
  questions: [{
    question: "Does this plan look good to post to Linear?",
    header: "Plan review",
    options: [
      { label: "Yes, post to Linear", description: "Approve the plan and post it as a comment on the issue" },
      { label: "No, needs changes", description: "I'll provide feedback on what to adjust" }
    ],
    multiSelect: false
  }]
})
```

If the user wants changes, revise the plan and ask again.

### 10. Post plan to Linear

Once approved, post the plan you wrote in step 8 to Linear:

```
mcp__linear-server__save_comment({
  issueId: "HON-XX",
  body: "[The complete plan from step 8, including the markdown structure]"
})
```

### 11. Move issue to In Progress and claim it

Update the issue status so other auto-implement sessions won't pick it up. A claimed issue must always have an assignee (matches `/auto-implement` step 2.2 — 2.1 is the pre-claim gate), but never take an issue away from a teammate.

**If the issue is unassigned or already assigned to me** (from the assignee noted in step 2), claim it in a single call:

```
mcp__linear-server__save_issue({
  id: "HON-XX",
  state: "In Progress",
  assignee: "me"
})
```

**If assigned to someone else**, keep the existing assignee — move the status only, and warn the user (same handling as `/implement-issue`: warn before reassigning; do not reassign silently):

```
mcp__linear-server__save_issue({
  id: "HON-XX",
  state: "In Progress"
})
```

```
HON-XX is assigned to <name>; left assignment unchanged.
```

### 12. Output completion

Output the completion marker:

```
[plan-issue:complete] Plan posted to HON-XX
```

**If `--auto` flag was NOT used:** Also output:

```
Run `/implement-issue HON-XX` when ready to start implementation.
```

Then STOP. Do not proceed to implementation, do not offer next steps, do not ask questions.

**If `--auto` flag WAS used:** Do NOT output the "Run /implement-issue" message. Just output the completion marker. The orchestrating skill (auto-implement) will handle the next step.

## Important

- Include the issue ID in the plan header (required for `/implement-issue` validation)
- Include the `gitBranchName` from Linear
- Be specific about file paths (use absolute paths from project root)
- Order implementation steps by dependency
- Include verification steps that can be checked after implementation
- If the issue has acceptance criteria, map them to verification steps
- **Never suggest or prompt to start implementation** - the skill ends after posting to Linear
