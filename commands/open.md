---
description: Open the VisFlow architecture map for this project in the browser.
disable-model-invocation: true
allowed-tools: Bash
---

# Open the VisFlow map

Check the plugin's CLI bundle exists, then launch the map server.

!`test -f "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" && echo "cli: found" || echo "cli: NOT FOUND — reinstall the plugin (or, in dev, run 'npm run build' in the visflow repo)"`

---

Using the Bash tool, start the local map server **in the background** (so it keeps serving without blocking this session):

```
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/index.js" open
```

This serves the map at `http://127.0.0.1:5199` and opens it in the browser. Tell the user the map is running at that URL. If port 5199 is busy, the command's error output suggests `--port <N>` — retry with a free port and tell the user the final URL. If the CLI bundle was not found above, relay that guidance instead of running anything.
