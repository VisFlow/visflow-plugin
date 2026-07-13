---
description: Reconcile recorded decisions with the current VisFlow map — report and reattach orphaned decisions.
disable-model-invocation: true
allowed-tools: Read, Edit, Bash
---

# Sync VisFlow decisions

`/visflow:sync` **forces a full background-style reconcile** of the map against the current code, then prints the **decisions report** (totals, per-component counts, and any still-orphaned decisions). The reconcile pass re-derives the map from recent activity and reassigns decisions to their current components; the report you see reflects the **post-reconcile** state.

Unlike the automatic on-Stop reconcile — which is **scoped** to just the files you changed that turn and their immediate neighbors — `/visflow:sync` performs a **broad catch-up**: it may inspect the whole repository to rebuild a stale or incomplete map. It is slower but is the way to fully resync after large, batched, or externally made changes.

The reconcile runs through your own Claude Code session (or `ANTHROPIC_API_KEY` if that env var is set). It is **read-only and gate-validated**: it may only read code (no edits, writes, or shell), and changes are applied only after passing VisFlow's safety gates (schema validation + node-loss check), so a bad proposal is skipped rather than applied.

After the reconcile, **orphaned** decisions are reasoning recorded under a component id that has no matching node in the map — usually because the id was renamed, or the decision was logged before the component existed.

## Step 1 — Force the reconcile and read the report
Using the Bash tool, run:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" sync
```

If it reports `No orphaned decisions.`, tell the user everything is reconciled and stop.

If it cannot find a graph, tell the user to run `/visflow:init` first and stop.

## Step 2 — Reattach orphans (only if any were reported)
For each orphaned id the report lists:
- Read `.visflow/graph.json` and look at the current component ids and labels.
- Read `.visflow/decisions.json`.
- Decide the best current component id for the orphan: prefer a clear rename match (e.g. `old-name` → `auth-service` when the files/label line up). If nothing matches confidently, leave it as-is and tell the user (its decisions stay parked and will surface automatically if a node with that id appears later).
- To reattach, use the Edit tool on `.visflow/decisions.json`: move the orphan's array under the chosen current id (merge into that id's existing array if it already has one), and remove the orphan key. Preserve every `{ what, why, source, ts }` entry exactly — never drop or invent decisions.

## Step 3 — Verify and report
Run the same sync command again and confirm the orphan count dropped (or is explained). Tell the user what you reattached (orphan id → new id) and what you left parked, and suggest a manual browser refresh of the map to see the moved decisions.
