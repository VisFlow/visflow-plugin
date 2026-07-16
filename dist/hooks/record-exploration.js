import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// src/hooks/record-exploration.ts
import { readFileSync as readFileSync2 } from "node:fs";

// src/core/is-main.ts
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

// src/core/exploration-log.ts
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
function explorationLogPath(repoRoot) {
  return join(repoRoot, ".visflow", "exploration.log");
}
function appendExploration(repoRoot, rec) {
  try {
    mkdirSync(join(repoRoot, ".visflow"), { recursive: true });
    appendFileSync(explorationLogPath(repoRoot), JSON.stringify(rec) + "\n");
  } catch {
  }
}

// src/hooks/record-exploration.ts
var EXPLORE_TOOLS = /* @__PURE__ */ new Set(["Read", "Grep", "Glob"]);
var TASK_ID_RE = /--task-id[=\s]+(\S+)/;
function parseExploration(transcript) {
  let taskId = null;
  let exploreCount = 0;
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const content = o?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || b.type !== "tool_use") continue;
      if (EXPLORE_TOOLS.has(b.name)) {
        exploreCount++;
      } else if (b.name === "Bash" && taskId === null) {
        const cmd = String(b.input?.command ?? "");
        if (/\bcontext\b/.test(cmd)) {
          const m = TASK_ID_RE.exec(cmd);
          if (m) taskId = m[1];
        }
      }
    }
  }
  return { taskId, exploreCount };
}
function handleSubagentStop(payloadRaw, deps) {
  let p;
  try {
    p = JSON.parse(payloadRaw);
  } catch {
    return { recorded: false, reason: "bad payload" };
  }
  const cwd = p.cwd;
  if (!cwd) return { recorded: false, reason: "no cwd" };
  if (!p.transcript_path) return { recorded: false, reason: "no transcript" };
  let raw;
  try {
    raw = readFileSync2(p.transcript_path, "utf8");
  } catch {
    return { recorded: false, reason: "transcript unreadable" };
  }
  const { taskId, exploreCount } = parseExploration(raw);
  (deps.append ?? appendExploration)(cwd, { ts: deps.now(), taskId: taskId ?? "", sessionId: p.session_id, exploreCount, cwd });
  return { recorded: true, reason: taskId ? "recorded" : "recorded (unattributed)" };
}
function main() {
  let raw = "";
  try {
    raw = readFileSync2(0, "utf8");
  } catch {
    return;
  }
  handleSubagentStop(raw, { now: () => (/* @__PURE__ */ new Date()).toISOString() });
}
if (isMain(import.meta.url)) main();
export {
  handleSubagentStop,
  parseExploration
};
