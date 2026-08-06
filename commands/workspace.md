---
description: Connect existing VisFlow maps, discover cross-repository relationships, review them, and open the combined map.
disable-model-invocation: true
allowed-tools: Read, Glob, Bash
---

# Create or extend a VisFlow multi-repository workspace

This flow connects two or more **existing, independently mapped repositories**. It does not clone
repositories, initialize missing maps, rebuild member maps, merge `.visflow/` directories, or
create commits. The deterministic CLI is the only writer for
`.visflow-workspace/`; do not write `workspace.json` or `locations.json` directly.

## Step 1 — Choose the workspace and member checkouts

Treat the current directory as the workspace parent. Ask the user for two or more repository
paths if they were not supplied with the request. Resolve each path and check:

```bash
test -f "<repo-path>/.visflow/config.json" && test -f "<repo-path>/.visflow/graph.json" && echo "READY" || echo "NEEDS-MAP"
```

If any repository prints `NEEDS-MAP`, stop. Tell the user to enter that repository and run
`/visflow:init`, then rerun `/visflow:workspace`. Parent-driven initialization belongs to a later
release; do not run init on their behalf from this workspace.

## Step 2 — Connect the existing maps

Run one CLI command, preserving the user's path order:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" workspace connect "<repo-path-1>" "<repo-path-2>" ["<repo-path-N>"] [--label "<workspace label>"]
```

If a workspace already exists, this safely registers any new members. Explain that each
repository remains separate and authoritative: its graph and decisions were not rebuilt,
copied, or merged.

## Step 3 — Discover and review relationships

Run deterministic boundary discovery after all member maps validate:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" workspace discover
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" workspace candidates
```

Discovery creates review candidates and never silently changes `workspace.json`. Show the user
the source, target, confidence, and evidence for every candidate. For each accepted candidate run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" workspace approve "<candidate-id>"
```

For each rejected candidate run `workspace dismiss "<candidate-id>"`; it stays suppressed until
material evidence changes. Approved inferred links are marked `managedBy: "reconciler"` and are
maintained by later workspace syncs. Manual links remain supported and are never changed by
automatic reconciliation:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" workspace link --from "<source-alias>/<node-id>" --to "<target-alias>/<node-id>" [--what "<what is used>"] [--why "<reason>"]
```

Direction is exact: `source depends on target`. Never guess node ids or write relationship JSON
directly.

## Step 4 — Validate and open

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" workspace validate
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" workspace sync --links-only
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" workspace open
```

Relay all degraded-member or unresolved-link warnings. Tell the user the printed loopback URL and
that unavailable checkouts can be repaired with
`visflow workspace locate <alias> <repo-path>`. Nothing was committed and no member map or
decisions file was edited.
