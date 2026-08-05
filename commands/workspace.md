---
description: Connect existing VisFlow maps into a multi-repository workspace, validate it, and open the combined map.
disable-model-invocation: true
allowed-tools: Read, Glob, Bash
---

# Create or extend a VisFlow multi-repository workspace

This flow connects two or more **existing, independently mapped repositories**. It does not clone
repositories, initialize missing maps, rebuild member maps, merge `.visflow/` directories, infer
cross-repository links, or create commits. The deterministic CLI is the only writer for
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

## Step 3 — Add explicit relationships (optional)

Cross-repository relationships are manual in this release. Do not claim automatic discovery.
Ask whether the user wants to add known links. For every confirmed relationship, run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" workspace link --from "<source-alias>/<node-id>" --to "<target-alias>/<node-id>" [--what "<what is used>"] [--why "<reason>"]
```

Direction is exact: `source depends on target`. If the user does not know component ids, run
workspace validate, open the map, and let them add links later rather than guessing.

## Step 4 — Validate and open

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" workspace validate
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" workspace open
```

Relay all degraded-member or unresolved-link warnings. Tell the user the printed loopback URL and
that unavailable checkouts can be repaired with
`visflow workspace locate <alias> <repo-path>`. Nothing was committed and no member map or
decisions file was edited.
