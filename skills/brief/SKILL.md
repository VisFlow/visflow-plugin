---
name: brief
description: Use when dispatching subagents in a repo with a VisFlow map (.visflow/graph.json) — briefs each task with a component capsule so subagents start from the map instead of re-exploring the repo
---

# VisFlow briefing protocol (SDD)

Brief every dispatched subagent with a component capsule from the VisFlow map. The map is the
developer's tool; this protocol is the agent-facing surface of the same graph.

**CLI:** `visflow` when it is on PATH (npm link / global install); otherwise
`node <plugin-root>/dist/cli/index.js` — plugin installs don't put bins on PATH. Substitute the
resolved command everywhere below.

## Protocol

1. **At plan-execution start:** run `visflow index`; treat it as the component map for
   decomposition. It is a few hundred tokens and doubles as planning context.
2. **Per task dispatch:** pick seed nodes from the index — 2–4 typical; over-include when
   unsure, ids from the index only, and prefer a second pull over an 8-seed capsule. Build the
   mini-capsule from index data (seed one-liners + decision titles, ~200 tokens); use the
   dispatch template below. Mint one stable `--task-id` per task dispatch (any short unique
   token, e.g. `t1`, `t2`) and carry the same id into every re-pull for that task — that id, not
   the prose, is how re-pulls are counted. Task summaries: single line, no double quotes — they
   ride a shell command.
3. **Between tasks:** re-run `visflow index` after any turn where a reconcile applied, or when a
   context pull errors unknown-node — the background reconcile can add/remove/rename nodes
   mid-session. Content staleness needs no refresh: capsules self-report it at pull time.
4. **At check-in:** relay any "Briefing accuracy" report that isn't a clean match to the human —
   the signal must not dead-end in your context.
5. **Reviewing effectiveness:** `visflow report` joins served capsules (`briefings.log`) with the
   structured feedback (`feedback.log`) and post-briefing exploration counts (`exploration.log`) —
   re-pull rate, capsules-per-task, nodes flagged for re-reconcile, protocol gaps, exploration as a
   soft symptom, and the routing/ignored cases queued for human review.

## Dispatch template (add to every task prompt)

> **Component briefing (mini):** <seed one-liners + decision titles>
> **Step 1 — before reading code:** run
> `visflow context --nodes <ids> --task-id <id> --task "<task summary>"` and read the capsule. It
> includes decisions that constrain this area and who depends on what you're changing. If you pull
> again mid-task, reuse this exact `--task-id <id>` — that is how re-pulls are counted. `--task` is
> display prose and may be reworded freely.
> **At task end — record structured feedback:** call the `visflow_briefing_feedback` tool with the
> SAME `task-id`, a `verdict`, the node id(s) it is about, and a one-line `detail`. Verdicts:
> `matched` (the capsule was accurate and sufficient), `misinformed` (a seeded node's map data was
> WRONG — name that node), `uninformed` (needed context was MISSING — name the files and/or node),
> `had-to-search` (the right node existed but you still had to search for more), `ignored` (you had
> what you needed but did not use it). `misinformed`/`uninformed` auto-trigger a scoped re-reconcile
> of the named node(s) FROM CODE on the next sync; `had-to-search`/`ignored` are surfaced to a human.
> **Also** put the same content in a human-readable "Briefing accuracy" line in your final report so
> the check-in below can relay it.
