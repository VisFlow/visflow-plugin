---
description: Safely stop the active VisFlow reconciliation without losing queued edits.
disable-model-invocation: true
allowed-tools: Bash
---

# Cancel VisFlow reconciliation

Use the Bash tool to run:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" cancel
```

Report the command's result exactly. Cancellation is cooperative and token-owned: VisFlow asks
the active worker to terminate its model process, waits for it to close, and restores the drained
events and feedback targets unchanged so the next reconcile can retry them.

Never read a pid from `.visflow/.reconcile-running` or signal it directly. A pid may have been
reused; the command intentionally refuses legacy or unverifiable running markers.
