# VisFlow

A living, annotated architecture map for AI-built projects. VisFlow draws your repo as a
layered component map, keeps that map current while Claude Code edits your code, and pins
recorded design decisions to the components they belong to.

## Install

In Claude Code:

```
/plugin marketplace add bxu134/visflow-plugin
/plugin install visflow
```

Requirements: Claude Code with Node.js 20+. No API key needed — the map's background
reconcile runs through your own Claude Code session (set `ANTHROPIC_API_KEY` only if you
prefer direct API billing).

## Use

- `/visflow:init` — scan the repo and build `.visflow/graph.json` (the map)
- `/visflow:open` — open the interactive map in your browser
- `/visflow:sync` — force a full reconcile and print a decisions report
- **Decision log** — when you and Claude settle on an architectural choice, Claude records
  the what and the why (just say "record that decision" if it doesn't offer). Every decision
  is pinned to its component on the map and stays visible as the code evolves.

## How the living map works

- A `PostToolUse` hook buffers every edit into `.visflow/events.log`.
- When a session turn ends after code changes, a detached reconcile proposes a graph patch
  and applies it only through fail-closed gates: strict schema validation, a node-loss
  check, and an in-lock staleness recheck. A bad proposal is skipped, never applied.
- The map opens **condensed**: components are clustered into groups with aggregated edges;
  double-click a group to see its members. A `View: Condensed | Flat` toggle restores the
  classic full map.
- Everything stays on your machine: the map server binds 127.0.0.1 only, and all state
  lives in `.visflow/` inside your repo.

## Support

Bug reports and questions: [GitHub Issues](https://github.com/bxu134/visflow-plugin/issues).

## License

Free to install and use; not open source. See [LICENSE](LICENSE).

This repository contains the built plugin artifact and is published from a private source
repository — each release lands here as a single tagged commit.
