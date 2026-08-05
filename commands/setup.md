---
description: Configure VisFlow for this repository — choose whether the map is committed (shared with your team) or kept local, and set up .gitignore accordingly.
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Bash
---

# VisFlow setup

Configure how VisFlow stores its state in this repository. This flow asks ONE question (commit
posture), writes a managed `.gitignore` block plus `.visflow/config.json`, and STAGES the result.
It NEVER runs `git commit` — committing is always the user's move. Run no other VisFlow commands
from here.

## Step 1 — Detect state

Using the Bash tool, run:

```
git rev-parse --is-inside-work-tree 2>/dev/null || echo "NOT-GIT"
test -f .visflow/config.json && echo "CONFIGURED" || echo "UNCONFIGURED"
git ls-files .visflow 2>/dev/null
```

- **NOT-GIT** → not a git repository. Still ask the question (Step 3) and write the marker
  (Step 4a), but SKIP Steps 4b and 4c; in Step 5, note that commit posture takes effect only
  once the project is under git (re-run `/visflow:setup` then).
- **CONFIGURED** → Read `.visflow/config.json` (if it exists but does not parse as JSON, treat
  the repo as UNCONFIGURED — it will be rewritten). Report the current posture in one line,
  then ask whether the user wants to switch to the other posture. If no: stop — a clean no-op.
  If yes and the switch is **local→shared**: warn — "Heads up: `.visflow/decisions.json`
  (recorded design decisions) will become visible to everyone with repo access." — and get an
  explicit yes before continuing to Step 4 with the NEW posture. Skip Steps 2–3 when switching.
- **UNCONFIGURED** → continue.

The `git ls-files .visflow` output tells you whether map files are currently tracked — Step 4c
needs it to stage a posture switch correctly.

## Step 2 — Show license status (info only)

Using the Bash tool, run:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" license
```

Relay the output to the user in one line (trial days left / active license / next step). This
command is read-only and does not start the trial.

## Step 3 — Ask the ONE question

Ask the user, and STOP and wait for their answer:

> How should VisFlow store its map in this repository?
>
> 1. **Shared** — commit the map. `.visflow/graph.json` (the architecture map) and
>    `.visflow/decisions.json` (recorded design decisions) are tracked in git, so teammates,
>    reviewers, and CI see them. Runtime files (event queues, logs, locks) are gitignored.
> 2. **Local** — keep it private. Everything in `.visflow/` stays out of git; only a small
>    `.visflow/config.json` marker is staged so teammates aren't re-asked (it can be unstaged
>    for zero footprint).

## Step 4 — Apply the choice

### 4a. Write the config marker

For a fresh config, generate a stable repository identity with the Bash tool:

```
node -e "console.log(require('node:crypto').randomUUID())"
```

Use that value as `repositoryId`. When switching an existing posture, preserve its existing valid
`repositoryId` exactly — never regenerate it when a repository moves or is renamed.

Using the Write tool, write `.visflow/config.json` (creating the directory if needed):

```json
{
  "version": 1,
  "repositoryId": "<generated UUID>",
  "commitPosture": "shared",
  "configuredAt": "2026-01-01T00:00:00Z"
}
```

with `repositoryId` set to the generated-or-preserved UUID, `commitPosture` set to the chosen
posture (`"shared"` or `"local"`), and `configuredAt` set to the current UTC time in ISO-8601
format. The identity lets future workspace files refer to the repository without depending on its
checkout path. The config remains the marker that makes `/visflow:init` skip setup.

If Step 1 said NOT-GIT, skip to Step 5 now.

### 4b. Write the managed .gitignore block

Edit `.gitignore` at the repo root (create the file if absent). The VisFlow rules live between
EXACTLY these two marker lines:

```
# >>> visflow (managed by /visflow:setup) >>>
# <<< visflow <<<
```

If the markers already exist, REPLACE everything between them with the new rules (Edit tool).
Otherwise append the whole block (markers + rules) at the end of the file. NEVER modify
anything outside the markers.

Rules for **shared**:

```
.visflow/events.log
.visflow/briefings.log
.visflow/feedback.log
.visflow/exploration.log
.visflow/feedback-targets.log
.visflow/meta.json
.visflow/.reconcile-hashes.json
.visflow/.lock
.visflow/.meta-lock
.visflow/.reconcile-running
.visflow/.reconcile-cancel.json
.visflow/*.tmp-*
.visflow/*.draining-*
.visflow/*.stale-*
```

Rules for **local**:

```
.visflow/*
!.visflow/config.json
```

The local rules MUST be `.visflow/*` (not `.visflow/`): git cannot re-include
`!.visflow/config.json` when the parent directory itself is excluded.

Before staging, confirm the managed block actually took effect. Using the Bash tool, run
`git check-ignore -v` on each file this posture stages from `.visflow/`: `.visflow/config.json`
always, plus `.visflow/graph.json` and `.visflow/decisions.json` (whichever exist) when shared.
Under local, graph and decisions are meant to stay ignored, so do not check them. A file is
truly ignored only when the matched pattern is NOT negated — a `!`-prefixed match is the managed
block's own re-include of `.visflow/config.json` and means the file is fine. A correct managed
block leaves every checked file un-ignored, so any non-negated match means a rule OUTSIDE the
managed markers (usually a bare `.visflow/` line the user added) is overriding it. If so: STOP —
do not run Step 4c, and stage nothing (not even `.gitignore`). Tell the user the offending rule
and its source (the `file:line:pattern` that `check-ignore -v` prints), that it sits outside the
VisFlow-managed block so this flow won't touch it, and to remove or narrow it (e.g. that bare
`.visflow/` line). Then give them the recovery command to run once fixed:
`git add .gitignore .visflow/config.json` (append `.visflow/graph.json .visflow/decisions.json`
if shared and they exist) — a re-run of `/visflow:setup` sees the repo as CONFIGURED and won't
re-stage.

### 4c. Stage — never commit

Using the Bash tool:

- Both postures: `git add .gitignore .visflow/config.json`
- **Shared**: also `git add .visflow/graph.json .visflow/decisions.json` — each only if the
  file exists. (If this is a local→shared switch, you already warned and got a yes in Step 1.)
- **Local**, on a shared→local switch: `git rm --cached` each of `.visflow/graph.json` and
  `.visflow/decisions.json` — each only if that file appeared in Step 1's `git ls-files .visflow`
  output (only if tracked); untracks it, the file stays on disk. Skip any Step 1 did not list.

Do NOT run `git commit`.

## Step 5 — Report

Tell the user, concretely:

- The posture now configured and what it means, in one line.
- Exactly which files were written and which are staged (show `git status --porcelain` output
  if it helps).
- That NOTHING was committed — they should review and commit when ready.
- Local posture only: `.visflow/config.json` is the only staged trace; they may unstage it for
  zero footprint, at the cost of teammates being asked again.
- NOT-GIT only: posture takes effect once the project is under git; re-run `/visflow:setup` then.
- Next step: `/visflow:init` to build the map if `.visflow/graph.json` does not exist, or
  `/visflow:open` to view it if it does.
