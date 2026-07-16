---
description: Scan this repository and build/refresh the VisFlow architecture map (.visflow/graph.json).
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Bash
---

# Build the VisFlow architecture map

Your job: read this repository and produce a single file, `.visflow/graph.json`, that maps the project's architecture as a layered graph of **logical components**. Then validate it.

## Step 0 — Check for an existing map (confirm before overwriting)
Using the Bash tool, check whether a map already exists:

!`test -f .visflow/graph.json && echo "EXISTS" || echo "NONE"`

- If the result is `EXISTS`: this command performs a **full reset** of `.visflow/graph.json` — it rebuilds the structure from scratch and will overwrite the current `graph.json`. Reassure the user that **`.visflow/decisions.json` is NOT touched** (their recorded reasoning is preserved). Then **ask the user to confirm** they want to rebuild the map, and **STOP and wait for an explicit yes** before doing anything else. If they decline, end here without changing any files.
- If the result is `NONE`: there is no existing map, so continue without prompting.

## Step 1 — Explore
- Use Glob/Grep/Read to understand the project. Honor `.gitignore`; ignore `node_modules`, build output (`dist`, `build`, `.next`, `out`), and lockfiles.
- Identify the real, meaningful parts of the system.

## Step 2 — Model it as components
- A **component is a logical thing** ("Auth Service", "Login Page", "Users Table"), **NOT one-node-per-file.** A component groups one or more real files.
- **`files` MUST enumerate the component's actual source files** — list every git-tracked source file that belongs to it, as real repo-relative paths. Never use a lone `__init__.py`, a bare directory path, or a single "representative" file; exclude tests, docs, and examples. Even large components list every file: downstream consumers (context capsules, staleness joins, routing path-boost) match these paths exactly, and a render cap keeps briefings bounded, so completeness costs nothing.
- Aim for a legible map: roughly **5–25 components** for a small app. Merge trivial files into the component they serve.
- Assign every component exactly one **layer** from this fixed set, top to bottom:
  - `ui` — screens/pages/views the user sees
  - `client` — browser-side logic, state, API clients
  - `api` — HTTP endpoints / route handlers
  - `services` — server-side business logic
  - `data` — database tables, schemas, models, storage
  - `external` — third-party services and APIs
- Record dependencies in `dependsOn`. Each entry is either a bare component **id** string, or an object `{ "id": "<other-id>", "what": "<the specific thing this component uses from it>", "why": "<the reason this dependency exists>" }`. Prefer the annotated object form: when you can tell from the code *what* is used (a function, endpoint, table, type) and *why*, include short `what`/`why` strings; fall back to a bare id only when you genuinely can't. Every `id` (string or `{id}`) MUST be the id of another component in the file.
- For each component, write a one–two sentence `reasoning.summary`: what it is and why it exists. Set `reasoning.decisions` to `[]` (empty in this version).
- Cluster the components into **groups** — stable, subsystem-level buckets the map's condensed view opens with (e.g. "Frontend", "API & Services", "Data & Storage", "Build Tooling"). Groups may span layers. **Every component gets exactly one `group`.** Keep groups meaningful: typically 2+ components per group (avoid single-member groups when a sensible sibling exists); a small project may need only 2–4 groups, a larger one roughly 5–12. For each group, write a one-sentence `reasoning.summary` describing the subsystem.

## Step 3 — Write the file
Write `.visflow/graph.json` with EXACTLY this shape:

```json
{
  "version": 1,
  "groups": [
    {
      "id": "kebab-case-group-id",
      "label": "Human Readable Group Name",
      "reasoning": { "summary": "What this subsystem is." }
    }
  ],
  "nodes": [
    {
      "id": "kebab-case-id",
      "label": "Human Readable Name",
      "layer": "ui | client | api | services | data | external",
      "group": "kebab-case-group-id",
      "files": ["real/relative/path.ts", "real/relative/other.ts"],
      "dependsOn": [{ "id": "other-component-id", "what": "the thing used", "why": "the reason" }],
      "reasoning": { "summary": "What it is and why it exists.", "decisions": [] }
    }
  ]
}
```

Rules: `id` is unique kebab-case; `files` are real repo-relative paths that exist; `layer` is one of the six values exactly; `dependsOn` entries are bare ids or `{ id, what, why }` objects, and every `id` references an id defined in this file; every node's `group` is the id of an entry in `groups`; group ids are unique kebab-case and never the reserved `__ungrouped__`; every group has at least one member node.

## Step 4 — Validate (required)
Run this with the Bash tool and fix the file until it passes:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" validate
```

If it reports errors, correct `.visflow/graph.json` and run it again. Do not finish until it prints "Graph is valid".

## Step 5 — Report
Tell the user how many components and groups you found and suggest they run `/visflow:open` to view the map (it opens condensed — double-click a group to drill into its components).
