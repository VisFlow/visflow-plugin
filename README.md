# VisFlow

A living, annotated architecture map for AI-built projects. VisFlow draws your repo as a
layered component map, keeps that map current while Claude Code edits your code, and pins
recorded design decisions to the components they belong to.

## Install

In Claude Code:

```
/plugin marketplace add visflow/visflow-plugin
/plugin install visflow
```

Requirements: Claude Code with Node.js 20+. The map's background reconcile runs through
your own Claude Code session (set `ANTHROPIC_API_KEY` only if you prefer direct API
billing) — VisFlow never proxies or resells inference.

## Pricing

VisFlow 0.9+ starts with a **7-day free trial** — no key, no signup. Keeping the living
map after that is **$15/month or $144/year**: [visflow.dev/pricing](https://visflow.dev/pricing).
After subscribing, activate with `/visflow:license <key>`. Versions ≤0.8.x remain free
under the terms they shipped with.

## Use

- `/visflow:init` — scan the repo and build `.visflow/graph.json` (the map)
- `/visflow:open` — open the interactive map in your browser
- `/visflow:sync` — force a full reconcile and print a decisions report
- `/visflow:workspace` — connect existing repository maps into one repository-first view
- `/visflow:license` — activate a key, check trial/license status, or remove the key
- **Decision log** — when you and Claude settle on an architectural choice, Claude records
  the what and the why (just say "record that decision" if it doesn't offer). Every decision
  is pinned to its component on the map and stays visible as the code evolves.

### Multi-repository workspaces

From a parent directory, `/visflow:workspace` connects two or more repositories that already have
VisFlow maps. The repositories and their map/decision files remain separate; the workspace adds a
portable membership manifest and reviewed cross-repository relationships. Boundary matches are
discovered automatically, new inferred links require approval, approved links are maintained on
workspace sync, and manual links are never changed automatically. This release does not initialize
missing member maps.

The equivalent CLI flow is:

```bash
visflow workspace connect ./web ./api --label "Product"
visflow workspace discover
visflow workspace candidates
visflow workspace approve <candidate-id>
visflow workspace validate
visflow workspace sync --links-only
visflow workspace open
```

## How the living map works

- A `PostToolUse` hook buffers every edit into `.visflow/events.log`.
- When a session turn ends after code changes, a detached reconcile proposes a graph patch
  and applies it only through fail-closed gates: strict schema validation, a node-loss
  check, and an in-lock staleness recheck. A bad proposal is skipped, never applied.
- The map opens **condensed**: components are clustered into groups with aggregated edges;
  double-click a group to see its members. A `View: Condensed | Flat` toggle restores the
  classic full map.
- Everything stays on your machine: the map server binds 127.0.0.1 only, and all state
  lives in `.visflow/` inside your repo. The only network call VisFlow itself makes is a
  periodic license check (with a 14-day offline grace window).

## Support

Bug reports and questions: [GitHub Issues](https://github.com/visflow/visflow-plugin/issues) or email support@visflow.dev

## License

7-day free trial, then subscription. Not open source. See [LICENSE](LICENSE).
Versions ≤0.8.x remain governed by the VisFlow Community License they shipped with.

This repository contains the built plugin artifact and is published from a private source
repository — each release lands here as a single tagged commit.
