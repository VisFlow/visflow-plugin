---
description: Activate, inspect, or remove your VisFlow license key on this machine.
disable-model-invocation: true
allowed-tools: Bash
---

# VisFlow license

Manage the VisFlow license for this machine. User arguments: $ARGUMENTS

Using the Bash tool, run:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" license $ARGUMENTS
```

Relay the output to the user (present any URL as a clickable link).

- `/visflow:license <key>` — activate a key on this machine (keys come with a subscription from https://visflow.dev/pricing)
- `/visflow:license` — show status: trial days left, active license, or what to do next
- `/visflow:license remove` — remove the key from this machine and free its device slot
