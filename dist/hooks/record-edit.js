import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// src/hooks/record-edit.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { isAbsolute, relative, normalize } from "node:path";

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

// src/core/events-log.ts
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
function eventsLogPath(repoRoot) {
  return join(repoRoot, ".visflow", "events.log");
}
function appendEvent(repoRoot, ev) {
  mkdirSync(join(repoRoot, ".visflow"), { recursive: true });
  appendFileSync(eventsLogPath(repoRoot), JSON.stringify(ev) + "\n");
}

// src/hooks/record-edit.ts
function handleEdit(payloadRaw, env, now) {
  if (env.VISFLOW_RECONCILING) return;
  let p;
  try {
    p = JSON.parse(payloadRaw);
  } catch {
    return;
  }
  const file = p.tool_input?.file_path ?? p.tool_input?.notebook_path;
  if (!file || !p.cwd) return;
  if (isAbsolute(file)) {
    const rel = relative(p.cwd, file);
    if (rel.startsWith("..") || isAbsolute(rel)) return;
  } else if (normalize(file).startsWith("..")) {
    return;
  }
  appendEvent(p.cwd, { file, tool: p.tool_name ?? "unknown", ts: now() });
}
function main() {
  try {
    let raw = "";
    try {
      raw = readFileSync2(0, "utf8");
    } catch {
      return;
    }
    handleEdit(raw, process.env, () => (/* @__PURE__ */ new Date()).toISOString());
  } catch {
  }
}
if (isMain(import.meta.url)) main();
export {
  handleEdit
};
