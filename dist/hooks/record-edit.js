import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// src/hooks/record-edit.ts
import { readFileSync as readFileSync3 } from "node:fs";
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

// src/license/state.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync, renameSync as renameSync2 } from "node:fs";
import { homedir } from "node:os";
import { join as join2 } from "node:path";
function licenseDir(env) {
  return env.VISFLOW_LICENSE_DIR ?? join2(homedir(), ".config", "visflow");
}
var statePath = (env) => join2(licenseDir(env), "license.json");
function readLicenseState(env) {
  try {
    const parsed = JSON.parse(readFileSync2(statePath(env), "utf8"));
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

// src/hooks/record-edit.ts
function handleEdit(payloadRaw, env, now) {
  if (env.VISFLOW_RECONCILING) return;
  if (!checkEntitlementCached({ ...process.env, ...env }).allowed) return;
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
      raw = readFileSync3(0, "utf8");
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
