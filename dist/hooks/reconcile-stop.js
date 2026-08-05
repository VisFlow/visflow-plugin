import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// src/hooks/reconcile-stop.ts
import { spawn } from "node:child_process";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { dirname as dirname2, join as join6 } from "node:path";
import { readFileSync as readFileSync6, existsSync as existsSync4 } from "node:fs";

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
import { appendFileSync, mkdirSync, readFileSync as readFileSync2, renameSync as renameSync2, rmSync as rmSync2, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// src/core/stale-pid-file.ts
import { readFileSync, statSync, renameSync, rmSync, utimesSync } from "node:fs";
function readPidFileOwner(path) {
  try {
    const raw = readFileSync(path, "utf8");
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const pid = Number(trimmed);
      return Number.isInteger(pid) && pid > 0 ? { pid, raw } : null;
    }
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return null;
    const owner = parsed;
    if (!Number.isInteger(owner.pid) || owner.pid <= 0) return null;
    if (typeof owner.token !== "string" || owner.token.length === 0) return null;
    return { pid: owner.pid, token: owner.token, raw };
  } catch {
    return null;
  }
}
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH";
  }
}
function isStalePidFile(path, ttlMs) {
  try {
    if (Date.now() - statSync(path).mtimeMs > ttlMs) return true;
    const owner = readPidFileOwner(path);
    if (!owner) return false;
    return !isPidAlive(owner.pid);
  } catch {
    return false;
  }
}

// src/core/events-log.ts
var MAX_EVENT_RETRIES = 3;
function eventsLogPath(repoRoot) {
  return join(repoRoot, ".visflow", "events.log");
}
function parseEvents(raw) {
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev && typeof ev.file === "string") out.push(ev);
    } catch {
    }
  }
  return out;
}
function appendEvent(repoRoot, ev) {
  mkdirSync(join(repoRoot, ".visflow"), { recursive: true });
  appendFileSync(eventsLogPath(repoRoot), JSON.stringify(ev) + "\n");
}
function readEvents(repoRoot) {
  try {
    return parseEvents(readFileSync2(eventsLogPath(repoRoot), "utf8"));
  } catch {
    return [];
  }
}
function drainEvents(repoRoot) {
  const path = eventsLogPath(repoRoot);
  if (!existsSync(path)) return { events: [], commit: () => {
  }, restore: () => 0 };
  const snapshot = `${path}.draining-${process.pid}-${Date.now()}`;
  renameSync2(path, snapshot);
  let events = [];
  let note;
  try {
    events = parseEvents(readFileSync2(snapshot, "utf8"));
  } catch {
    note = "events snapshot unreadable; contents discarded";
  }
  return {
    events,
    note,
    commit: () => rmSync2(snapshot, { force: true }),
    restore: (opts) => {
      const bump = opts?.bumpRetry ?? true;
      let abandoned = 0;
      for (const ev of events) {
        if (!bump) {
          appendEvent(repoRoot, ev);
          continue;
        }
        const retry = (ev.retry ?? 0) + 1;
        if (retry >= MAX_EVENT_RETRIES) {
          abandoned++;
          continue;
        }
        appendEvent(repoRoot, { ...ev, retry });
      }
      rmSync2(snapshot, { force: true });
      return abandoned;
    }
  };
}
function hasRecoverableEventDrains(repoRoot) {
  const dir = join(repoRoot, ".visflow");
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  return entries.some((name) => {
    const m = /^events\.log\.draining-(\d+)-\d+$/.exec(name);
    return !!m && !isPidAlive(Number.parseInt(m[1], 10));
  });
}

// src/core/feedback-targets.ts
import { appendFileSync as appendFileSync2, existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync3, readdirSync as readdirSync2, renameSync as renameSync3, rmSync as rmSync3 } from "node:fs";
import { join as join2 } from "node:path";
function targetsPath(repoRoot) {
  return join2(repoRoot, ".visflow", "feedback-targets.log");
}
function parseTargets(raw) {
  const nodeIds = /* @__PURE__ */ new Set();
  const files = /* @__PURE__ */ new Set();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      for (const n of rec.nodes ?? []) if (typeof n === "string") nodeIds.add(n);
      for (const f of rec.files ?? []) if (typeof f === "string") files.add(f);
    } catch {
    }
  }
  return { nodeIds: [...nodeIds], files: [...files] };
}
function readTargets(repoRoot) {
  try {
    return parseTargets(readFileSync3(targetsPath(repoRoot), "utf8"));
  } catch {
    return { nodeIds: [], files: [] };
  }
}
function hasRecoverableTargetDrains(repoRoot) {
  const dir = join2(repoRoot, ".visflow");
  let entries;
  try {
    entries = readdirSync2(dir);
  } catch {
    return false;
  }
  return entries.some((name) => {
    const m = /^feedback-targets\.log\.draining-(\d+)-\d+$/.exec(name);
    return !!m && !isPidAlive(Number.parseInt(m[1], 10));
  });
}

// src/core/run-guard.ts
var GUARD_TTL_MS = 10 * 60 * 1e3;

// src/core/gate.ts
var CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|ipynb|go|rs|java|rb|php|c|h|cc|cpp|cxx|hh|hpp|hxx|cs|swift|kt|kts|scala|sql|vue|svelte|astro|dart|m|mm|ex|exs|erl|clj|cljs|cljc|hs|ml|mli|lua|r|jl|pl|pm|groovy|gradle|zig|nim|proto|graphql|gql|sh|bash|zsh)$/i;
function shouldReconcile(input) {
  if (input.force) return true;
  return input.events.some((e) => CODE_EXT.test(e.file));
}

// src/core/meta.ts
import { readFileSync as readFileSync4, existsSync as existsSync3, writeFileSync as writeFileSync2, rmSync as rmSync4, statSync as statSync2, mkdirSync as mkdirSync4 } from "node:fs";
import { join as join4 } from "node:path";

// src/core/atomic.ts
import { writeFileSync, renameSync as renameSync4, mkdirSync as mkdirSync3 } from "node:fs";
import { dirname, basename, join as join3 } from "node:path";
function writeJsonAtomic(targetPath, data) {
  const dir = dirname(targetPath);
  mkdirSync3(dir, { recursive: true });
  const tmp = join3(dir, `.${basename(targetPath)}.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync4(tmp, targetPath);
}

// src/core/meta.ts
function metaPath(repoRoot) {
  return join4(repoRoot, ".visflow", "meta.json");
}
function readMeta(repoRoot) {
  try {
    const d = JSON.parse(readFileSync4(metaPath(repoRoot), "utf8"));
    return {
      version: 1,
      lastSync: d.lastSync ?? null,
      lastResult: d.lastResult,
      lastReason: d.lastReason,
      startedAt: d.startedAt,
      cost: d.cost,
      lastSkip: d.lastSkip,
      scope: d.scope
    };
  } catch {
    return { version: 1, lastSync: null };
  }
}
function writeMeta(repoRoot, meta) {
  writeJsonAtomic(metaPath(repoRoot), meta);
}
function updateMeta(repoRoot, update, opts = {}) {
  const lockTimeoutMs = opts.lockTimeoutMs ?? 1500;
  const staleMs = opts.staleMs ?? 1e3;
  const lockPath = join4(repoRoot, ".visflow", ".meta-lock");
  mkdirSync4(join4(repoRoot, ".visflow"), { recursive: true });
  const deadline = Date.now() + lockTimeoutMs;
  let locked = false;
  while (Date.now() < deadline) {
    try {
      writeFileSync2(lockPath, `${process.pid}`, { flag: "wx" });
      locked = true;
      break;
    } catch {
      try {
        if (Date.now() - statSync2(lockPath).mtimeMs > staleMs) {
          rmSync4(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      const spinUntil = Date.now() + 5;
      while (Date.now() < spinUntil) {
      }
    }
  }
  try {
    writeMeta(repoRoot, update(readMeta(repoRoot)));
  } finally {
    if (locked) {
      try {
        if (readFileSync4(lockPath, "utf8") === `${process.pid}`) rmSync4(lockPath, { force: true });
      } catch {
      }
    }
  }
}

// src/license/state.ts
import { mkdirSync as mkdirSync5, readFileSync as readFileSync5, writeFileSync as writeFileSync3, renameSync as renameSync5 } from "node:fs";
import { homedir } from "node:os";
import { join as join5 } from "node:path";
function licenseDir(env) {
  return env.VISFLOW_LICENSE_DIR ?? join5(homedir(), ".config", "visflow");
}
var statePath = (env) => join5(licenseDir(env), "license.json");
function readLicenseState(env) {
  try {
    const parsed = JSON.parse(readFileSync5(statePath(env), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// src/license/polar-config.ts
var PRICING_URL = "https://visflow.dev/pricing";

// src/license/entitlement.ts
var TRIAL_DAYS = 7;
var REVALIDATE_DAYS = 3;
var GRACE_DAYS = 14;
var DAY_MS = 864e5;
var day = (iso, plusDays = 0) => new Date(new Date(iso).getTime() + plusDays * DAY_MS).toISOString().slice(0, 10);
function decideCached(state, now) {
  if (state?.key) {
    if (state.status === "revoked")
      return { allowed: false, kind: "revoked", warnings: [], refusal: `VisFlow: subscription inactive \u2014 manage it at ${PRICING_URL}` };
    const age = now.getTime() - (state.lastValidatedAt ? new Date(state.lastValidatedAt).getTime() : 0);
    if (age <= REVALIDATE_DAYS * DAY_MS) return { allowed: true, kind: "licensed", warnings: [] };
    if (age <= GRACE_DAYS * DAY_MS) return { allowed: true, kind: "grace", warnings: [] };
    return {
      allowed: false,
      kind: "grace-expired",
      warnings: [],
      refusal: `VisFlow: license revalidation has been failing since ${day(state.lastValidatedAt ?? (/* @__PURE__ */ new Date(0)).toISOString())} \u2014 check your network, or manage your subscription at ${PRICING_URL}`
    };
  }
  if (!state?.trialStartedAt) return { allowed: true, kind: "none-started", warnings: [] };
  const end = new Date(state.trialStartedAt).getTime() + TRIAL_DAYS * DAY_MS;
  if (now.getTime() < end) {
    const daysLeft = Math.ceil((end - now.getTime()) / DAY_MS);
    return {
      allowed: true,
      kind: "trial",
      daysLeft,
      warnings: daysLeft <= 3 ? [`VisFlow trial: ${daysLeft} day(s) left \u2014 keep the living map: ${PRICING_URL}`] : []
    };
  }
  return {
    allowed: false,
    kind: "trial-expired",
    warnings: [],
    refusal: `VisFlow trial ended \u2014 subscribe at ${PRICING_URL}, then run /visflow:license <key>. Your existing .visflow/ map is untouched.`
  };
}
function checkEntitlementCached(env, now = /* @__PURE__ */ new Date()) {
  try {
    return decideCached(readLicenseState(env), now);
  } catch {
    return { allowed: true, kind: "licensed", warnings: [] };
  }
}

// src/hooks/reconcile-stop.ts
function liveRunGuard(repoRoot) {
  const guard = join6(repoRoot, ".visflow", ".reconcile-running");
  return existsSync4(guard) && !isStalePidFile(guard, GUARD_TTL_MS);
}
function writeSkip(repoRoot, ts, reason) {
  updateMeta(repoRoot, (m) => ({ ...m, version: 1, lastSkip: { ts, reason } }));
}
function handleStop(payloadRaw, env, deps) {
  if (env.VISFLOW_RECONCILING) return { spawned: false, reason: "sentinel set" };
  if (!checkEntitlementCached({ ...process.env, ...env }).allowed) return { spawned: false, reason: "license: dormant" };
  let p;
  try {
    p = JSON.parse(payloadRaw);
  } catch {
    return { spawned: false, reason: "bad payload" };
  }
  const cwd = p.cwd;
  if (!cwd) return { spawned: false, reason: "no cwd" };
  const events = deps.readEvents(cwd);
  const targets = (deps.readTargets ?? readTargets)(cwd);
  const hasTargets = targets.nodeIds.length > 0 || targets.files.length > 0;
  const recoverableEvents = hasRecoverableEventDrains(cwd);
  const recoverableTargets = hasRecoverableTargetDrains(cwd);
  const hasRecovery = recoverableEvents || recoverableTargets;
  const actionable = shouldReconcile({ events }) || hasTargets || hasRecovery;
  if ((events.length > 0 || hasTargets || hasRecovery) && liveRunGuard(cwd)) {
    const ts = (deps.now ?? (() => (/* @__PURE__ */ new Date()).toISOString()))();
    const targetCount = targets.nodeIds.length + targets.files.length;
    const details = [
      events.length > 0 ? `${events.length} event(s)` : void 0,
      targetCount > 0 ? `${targetCount} target(s)` : void 0,
      recoverableEvents ? "recoverable event snapshot(s)" : void 0,
      recoverableTargets ? "recoverable target snapshot(s)" : void 0
    ].filter(Boolean).join(", ");
    writeSkip(cwd, ts, `pass running (${details} left queued)`);
    return { spawned: false, reason: "gate: skipped (pass running; queue left)" };
  }
  if (!actionable) {
    if (events.length > 0) {
      const ts = (deps.now ?? (() => (/* @__PURE__ */ new Date()).toISOString()))();
      try {
        deps.drainEvents(cwd).commit();
      } catch {
        return { spawned: false, reason: "gate: skipped (drain failed; queue left for next turn)" };
      }
      writeSkip(cwd, ts, `docs-only (${events.length} event(s) consumed)`);
      return { spawned: false, reason: `gate: skipped (${events.length} non-code event(s) consumed)` };
    }
    return { spawned: false, reason: "gate: skipped" };
  }
  deps.spawnReconcile(cwd);
  return { spawned: true, reason: "spawned" };
}
function spawnReconcileDetached(repoRoot) {
  const reconcileEntry = join6(dirname2(fileURLToPath2(import.meta.url)), "..", "reconcile", "index.js");
  const child = spawn(process.execPath, [reconcileEntry], {
    cwd: repoRoot,
    env: { ...process.env, VISFLOW_RECONCILING: "1" },
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}
function main() {
  try {
    let raw = "";
    try {
      raw = readFileSync6(0, "utf8");
    } catch {
      return;
    }
    handleStop(raw, process.env, { spawnReconcile: spawnReconcileDetached, readEvents, drainEvents });
  } catch {
  }
}
if (isMain(import.meta.url)) main();
export {
  handleStop
};
