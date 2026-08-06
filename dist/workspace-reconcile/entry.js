import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

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

// src/license/state.ts
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
function licenseDir(env) {
  return env.VISFLOW_LICENSE_DIR ?? join(homedir(), ".config", "visflow");
}
var statePath = (env) => join(licenseDir(env), "license.json");
function readLicenseState(env) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(env), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function writeLicenseState(env, state) {
  const path = statePath(env);
  mkdirSync(licenseDir(env), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 384 });
  renameSync(tmp, path);
}

// src/license/polar-config.ts
var POLAR_ORG_ID = "c2278667-529a-4611-a9f6-728ca68b2096";
var POLAR_API_BASE = "https://api.polar.sh/v1";
var PRICING_URL = "https://visflow.dev/pricing";

// src/license/polar.ts
var TIMEOUT_MS = 3e3;
function polarClient(env = {}, fetchImpl = fetch) {
  const base = env.VISFLOW_POLAR_API_BASE ?? POLAR_API_BASE;
  const orgId = env.VISFLOW_POLAR_ORG_ID ?? POLAR_ORG_ID;
  const post = async (path, body) => {
    try {
      const res = await fetchImpl(`${base}/customer-portal/license-keys/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organization_id: orgId, ...body }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      const parsed = res.status === 204 ? {} : await res.json().catch(() => ({}));
      return { status: res.status, body: parsed };
    } catch {
      return { status: 0, body: null };
    }
  };
  const toResult = (r) => {
    if (r.status === 0 || r.status >= 500) return { ok: "unreachable", detail: r.status === 0 ? "network error" : `server error ${r.status}` };
    if (r.status >= 400) return { ok: "denied", detail: r.body?.detail ?? `rejected (${r.status})` };
    if (r.body?.status && r.body.status !== "granted") return { ok: "denied", detail: r.body.status };
    return { ok: "granted", activationId: r.body?.id, expiresAt: r.body?.expires_at ?? r.body?.license_key?.expires_at ?? null };
  };
  return {
    validate: async (key, activationId) => toResult(await post("validate", { key, ...activationId ? { activation_id: activationId } : {} })),
    activate: async (key, label) => toResult(await post("activate", { key, label })),
    deactivate: async (key, activationId) => {
      const r = await post("deactivate", { key, activation_id: activationId });
      return { ok: r.status === 204 || r.status >= 200 && r.status < 300 };
    }
  };
}

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
async function checkEntitlement(env, deps = {}) {
  const now = deps.now ?? /* @__PURE__ */ new Date();
  try {
    let state = readLicenseState(env);
    if (!state?.key && !state?.trialStartedAt) {
      state = { ...state ?? { version: 1 }, version: 1, trialStartedAt: now.toISOString() };
      writeLicenseState(env, state);
      const started = decideCached(state, now);
      return { ...started, warnings: [`VisFlow trial started \u2014 ${TRIAL_DAYS} days free, then $15/mo: ${PRICING_URL}`, ...started.warnings] };
    }
    const cached = decideCached(state, now);
    if (!state?.key || cached.kind === "licensed" || cached.kind === "revoked") return cached;
    const res = await (deps.polar ?? polarClient(env)).validate(state.key, state.activationId);
    if (res.ok === "granted") {
      writeLicenseState(env, { ...state, status: "granted", lastValidatedAt: now.toISOString(), expiresAt: res.expiresAt });
      return { allowed: true, kind: "licensed", warnings: [] };
    }
    if (res.ok === "denied") {
      writeLicenseState(env, { ...state, status: "revoked" });
      return decideCached({ ...state, status: "revoked" }, now);
    }
    if (cached.kind === "grace")
      return { ...cached, warnings: [`VisFlow: couldn't reach the license server \u2014 licensed mode continues until ${day(state.lastValidatedAt ?? now.toISOString(), GRACE_DAYS)}.`] };
    return cached;
  } catch {
    const cached = checkEntitlementCached(env, now);
    return cached.allowed ? { ...cached, warnings: [...cached.warnings, "VisFlow: license check hit an unexpected error \u2014 continuing."] } : cached;
  }
}

// src/workspace-reconcile/supervisor.ts
import { createHash as createHash5 } from "node:crypto";

// src/core/lock.ts
import { writeFileSync as writeFileSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync3, rmSync as rmSync2, statSync as statSync2 } from "node:fs";
import { dirname, join as join2 } from "node:path";

// src/core/stale-pid-file.ts
import { readFileSync as readFileSync2, statSync, renameSync as renameSync2, rmSync, utimesSync } from "node:fs";
function readPidFileOwner(path) {
  try {
    const raw = readFileSync2(path, "utf8");
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
function touchPidFile(path) {
  try {
    utimesSync(path, /* @__PURE__ */ new Date(), /* @__PURE__ */ new Date());
  } catch {
  }
}
function stealPidFile(path) {
  const grave = `${path}.stale-${process.pid}`;
  try {
    renameSync2(path, grave);
  } catch {
    return false;
  }
  try {
    rmSync(grave, { force: true });
  } catch {
  }
  return true;
}
function releaseOwnedPidFile(path, expectedRaw = `${process.pid}`) {
  try {
    if (readFileSync2(path, "utf8") === expectedRaw) rmSync(path, { force: true });
  } catch {
  }
}

// src/core/lock.ts
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withStateLock(stateDir, fn, opts = {}) {
  const retries = opts.retries ?? 100;
  const delayMs = opts.delayMs ?? 20;
  const staleMs = opts.staleMs ?? 6e4;
  const lockPath = join2(stateDir, ".lock");
  mkdirSync2(stateDir, { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync2(lockPath, `${process.pid}`, { flag: "wx" });
      break;
    } catch {
      if (isStalePidFile(lockPath, staleMs) && stealPidFile(lockPath)) continue;
      if (attempt >= retries) throw new Error("visflow: could not acquire .visflow/.lock");
      await sleep(delayMs);
    }
  }
  try {
    return await fn();
  } finally {
    releaseOwnedPidFile(lockPath);
  }
}
function withSyncMicroLock(lockPath, fn, opts = {}) {
  const lockTimeoutMs = opts.lockTimeoutMs ?? 1500;
  const staleMs = opts.staleMs ?? 1e3;
  mkdirSync2(dirname(lockPath), { recursive: true });
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
          rmSync2(lockPath, { force: true });
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
    return fn();
  } finally {
    if (locked) {
      try {
        if (readFileSync3(lockPath, "utf8") === `${process.pid}`) rmSync2(lockPath, { force: true });
      } catch {
      }
    }
  }
}

// src/core/run-guard.ts
import { writeFileSync as writeFileSync3, mkdirSync as mkdirSync3 } from "node:fs";
import { join as join3 } from "node:path";
import { randomUUID } from "node:crypto";
var GUARD_TTL_MS = 10 * 60 * 1e3;
function acquireStateRunGuard(stateDir, filename, opts = {}) {
  const ttlMs = opts.ttlMs ?? GUARD_TTL_MS;
  const path = join3(stateDir, filename);
  mkdirSync3(stateDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const token = randomUUID();
      const ownerRaw = JSON.stringify({ version: 1, pid: process.pid, token });
      writeFileSync3(path, ownerRaw, { flag: "wx" });
      const lease = setInterval(() => touchPidFile(path), Math.max(1e3, Math.floor(ttlMs / 5)));
      lease.unref();
      return {
        acquired: true,
        token,
        release: () => {
          clearInterval(lease);
          releaseOwnedPidFile(path, ownerRaw);
        }
      };
    } catch {
      if (attempt === 0 && isStalePidFile(path, ttlMs) && stealPidFile(path)) continue;
      break;
    }
  }
  return { acquired: false, release: () => {
  } };
}

// src/core/workspace-load.ts
import { existsSync as existsSync2, realpathSync as realpathSync2 } from "node:fs";
import { resolve } from "node:path";

// src/core/paths.ts
import { isAbsolute, normalize, relative, sep } from "node:path";
function isPathInside(parent, child) {
  return child === parent || child.startsWith(parent + sep);
}

// src/core/decisions.ts
import { readFileSync as readFileSync5 } from "node:fs";
import { join as join6 } from "node:path";

// src/core/load-graph.ts
import { readFileSync as readFileSync4 } from "node:fs";
import { join as join4 } from "node:path";

// ../../../Users/benxu/PROJECTS/visflow-all/visflow/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../../Users/benxu/PROJECTS/visflow-all/visflow/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../../Users/benxu/PROJECTS/visflow-all/visflow/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../../Users/benxu/PROJECTS/visflow-all/visflow/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../../Users/benxu/PROJECTS/visflow-all/visflow/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../../Users/benxu/PROJECTS/visflow-all/visflow/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../../Users/benxu/PROJECTS/visflow-all/visflow/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../../Users/benxu/PROJECTS/visflow-all/visflow/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// src/schema/limits.ts
var MAX_TEXT = 1e4;
var MAX_NAME = 500;
var MAX_GROUPS = 64;
var MAX_WORKSPACE_MEMBERS = 128;
var MAX_CROSS_REPO_LINKS = 4096;
var MAX_CROSS_LINK_EVIDENCE = 32;

// src/schema/graph-schema.ts
var LAYERS = ["ui", "client", "api", "services", "data", "external"];
var FlowSchema = external_exports.object({
  inbound: external_exports.string().max(MAX_TEXT).nullish().transform((v) => v || void 0),
  during: external_exports.string().max(MAX_TEXT).nullish().transform((v) => v || void 0),
  outbound: external_exports.string().max(MAX_TEXT).nullish().transform((v) => v || void 0)
});
var ReasoningSchema = external_exports.object({
  summary: external_exports.string().min(1).max(MAX_TEXT),
  flow: FlowSchema.nullish().transform((v) => v && (v.inbound ?? v.during ?? v.outbound) !== void 0 ? v : void 0)
});
var DepLinkSchema = external_exports.object({
  id: external_exports.string().min(1).max(MAX_NAME),
  what: external_exports.string().max(MAX_TEXT).optional(),
  why: external_exports.string().max(MAX_TEXT).optional()
});
var DependsOnEntry = external_exports.union([external_exports.string().min(1).max(MAX_NAME), DepLinkSchema]).transform((entry) => typeof entry === "string" ? { id: entry } : entry);
var GroupSchema = external_exports.object({
  id: external_exports.string().min(1).max(MAX_NAME),
  label: external_exports.string().min(1).max(MAX_NAME),
  reasoning: ReasoningSchema
});
var UNGROUPED_ID = "__ungrouped__";
var NodeSchema = external_exports.object({
  id: external_exports.string().min(1).max(MAX_NAME),
  label: external_exports.string().min(1).max(MAX_NAME),
  layer: external_exports.enum(LAYERS),
  // Optional group membership (condensed map). null normalizes to ABSENT: a sloppy
  // `"group": null` emit downgrades to sticky-repair/Ungrouped, never a gate failure (spec §3).
  group: external_exports.string().min(1).max(MAX_NAME).nullish().transform((v) => v ?? void 0),
  files: external_exports.array(external_exports.string().max(1e3)).default([]),
  dependsOn: external_exports.array(DependsOnEntry).default([]),
  reasoning: ReasoningSchema
});
var GraphSchema = external_exports.object({
  version: external_exports.literal(1),
  groups: external_exports.array(GroupSchema).default([]),
  nodes: external_exports.array(NodeSchema)
});
function validateGraph(data) {
  const parsed = GraphSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const graph = parsed.data;
  const errors = [];
  const ids = /* @__PURE__ */ new Set();
  for (const n of graph.nodes) {
    if (n.id === UNGROUPED_ID) errors.push(`Reserved node id: ${UNGROUPED_ID}`);
    if (ids.has(n.id)) errors.push(`Duplicate node id: ${n.id}`);
    ids.add(n.id);
  }
  for (const n of graph.nodes) {
    for (const dep of n.dependsOn) {
      if (!ids.has(dep.id)) errors.push(`Node "${n.id}" dependsOn unknown id "${dep.id}"`);
    }
  }
  const groupIds = /* @__PURE__ */ new Set();
  for (const g of graph.groups) {
    if (g.id === UNGROUPED_ID) errors.push(`Reserved group id: ${UNGROUPED_ID}`);
    if (groupIds.has(g.id)) errors.push(`Duplicate group id: ${g.id}`);
    if (ids.has(g.id)) errors.push(`Group id collides with node id: ${g.id}`);
    groupIds.add(g.id);
  }
  if (graph.groups.length > MAX_GROUPS) errors.push(`Too many groups: ${graph.groups.length} (max ${MAX_GROUPS})`);
  for (const n of graph.nodes) {
    if (n.group !== void 0 && !groupIds.has(n.group)) {
      errors.push(`Node "${n.id}" group references unknown id "${n.group}"`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, graph };
}

// src/core/load-graph.ts
function parseGraph(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: { kind: "invalid-json", messages: [e.message] } };
  }
  const result = validateGraph(data);
  if (!result.ok) {
    return { ok: false, error: { kind: "schema", messages: result.errors } };
  }
  return { ok: true, graph: result.graph, raw };
}
function loadGraph(repoRoot) {
  const path = join4(repoRoot, ".visflow", "graph.json");
  let raw;
  try {
    raw = readFileSync4(path, "utf8");
  } catch {
    return { ok: false, error: { kind: "not-found", messages: [`No graph found at ${path}. Run /visflow:init first.`] } };
  }
  return parseGraph(raw);
}

// src/core/atomic.ts
import { writeFileSync as writeFileSync4, renameSync as renameSync3, mkdirSync as mkdirSync4 } from "node:fs";
import { dirname as dirname2, basename, join as join5 } from "node:path";
function writeJsonAtomic(targetPath, data) {
  const dir = dirname2(targetPath);
  mkdirSync4(dir, { recursive: true });
  const tmp = join5(dir, `.${basename(targetPath)}.tmp-${process.pid}-${Date.now()}`);
  writeFileSync4(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync3(tmp, targetPath);
}

// src/schema/decisions-schema.ts
var DecisionSchema = external_exports.object({
  what: external_exports.string().min(1).max(MAX_TEXT),
  // cost-bomb guard (2026-07-07 review)
  why: external_exports.string().min(1).max(MAX_TEXT),
  source: external_exports.enum(["tool", "inferred"]).optional(),
  ts: external_exports.string().optional()
});
var DecisionsFileSchema = external_exports.object({
  version: external_exports.literal(1),
  decisions: external_exports.record(external_exports.string().max(MAX_NAME), external_exports.array(DecisionSchema))
});
function validateDecisions(data) {
  const parsed = DecisionsFileSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  return { ok: true };
}

// src/core/decisions.ts
var DecisionsInvalidError = class extends Error {
};
function decisionsPath(repoRoot) {
  return join6(repoRoot, ".visflow", "decisions.json");
}
function parseDecisions(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { version: 1, decisions: {} };
  }
  const result = validateDecisions(data);
  if (!result.ok) {
    throw new DecisionsInvalidError(
      `Invalid .visflow/decisions.json (hand-editable \u2014 fix and retry):
${result.errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }
  return data;
}
function readDecisions(repoRoot) {
  let raw;
  try {
    raw = readFileSync5(decisionsPath(repoRoot), "utf8");
  } catch {
    return { version: 1, decisions: {} };
  }
  return parseDecisions(raw);
}

// src/core/config.ts
import { readFileSync as readFileSync6 } from "node:fs";
import { join as join7 } from "node:path";
var RepositoryConfigSchema = external_exports.object({
  version: external_exports.literal(1),
  repositoryId: external_exports.string().uuid().optional(),
  commitPosture: external_exports.enum(["shared", "local"]).optional(),
  configuredAt: external_exports.string().optional()
}).passthrough();
var configPath = (repoRoot) => join7(repoRoot, ".visflow", "config.json");
function readRepositoryConfig(repoRoot) {
  let raw;
  try {
    raw = readFileSync6(configPath(repoRoot), "utf8");
  } catch {
    return { ok: false, reason: "missing", detail: "No .visflow/config.json found." };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: "invalid-json", detail: error.message };
  }
  const parsed = RepositoryConfigSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid-shape",
      detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
    };
  }
  return { ok: true, config: parsed.data };
}

// src/core/meta.ts
import { readFileSync as readFileSync7, existsSync } from "node:fs";
import { join as join8 } from "node:path";
function metaPath(repoRoot) {
  return join8(repoRoot, ".visflow", "meta.json");
}
function readMeta(repoRoot) {
  try {
    const d = JSON.parse(readFileSync7(metaPath(repoRoot), "utf8"));
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
function readMetaOrNull(repoRoot) {
  return existsSync(metaPath(repoRoot)) ? readMeta(repoRoot) : null;
}

// src/core/workspace-store.ts
import { readFileSync as readFileSync8 } from "node:fs";
import { join as join9 } from "node:path";

// src/schema/workspace-schema.ts
import { posix, win32 } from "node:path";
var UuidSchema = external_exports.string().uuid();
var AliasSchema = external_exports.string().min(1).max(64).regex(
  /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
  "must be lowercase kebab-case"
);
var WorkspaceMemberSchema = external_exports.object({
  repositoryId: UuidSchema,
  alias: AliasSchema,
  label: external_exports.string().min(1).max(MAX_NAME)
});
var QualifiedNodeRefSchema = external_exports.object({
  repositoryId: UuidSchema,
  nodeId: external_exports.string().min(1).max(MAX_NAME)
});
function isSafeWorkspaceRelativePath(value) {
  if (value.length === 0 || value.length > 4e3) return false;
  if (posix.isAbsolute(value) || win32.isAbsolute(value)) return false;
  const normalized = posix.normalize(value.replaceAll("\\", "/"));
  return normalized !== "." && normalized !== ".." && !normalized.startsWith("../");
}
var CrossRepoEvidenceSchema = external_exports.object({
  repositoryId: UuidSchema,
  path: external_exports.string().min(1).max(4e3).refine(isSafeWorkspaceRelativePath, "must be a repository-relative path"),
  detail: external_exports.string().max(MAX_TEXT).optional()
});
var CrossRepoLinkSchema = external_exports.object({
  id: UuidSchema,
  source: QualifiedNodeRefSchema,
  target: QualifiedNodeRefSchema,
  what: external_exports.string().max(MAX_TEXT).optional(),
  why: external_exports.string().max(MAX_TEXT).optional(),
  managedBy: external_exports.enum(["user", "reconciler"]),
  evidence: external_exports.array(CrossRepoEvidenceSchema).max(MAX_CROSS_LINK_EVIDENCE).optional()
});
var WorkspaceFileSchema = external_exports.object({
  version: external_exports.literal(1),
  id: UuidSchema,
  label: external_exports.string().min(1).max(MAX_NAME),
  members: external_exports.array(WorkspaceMemberSchema).max(MAX_WORKSPACE_MEMBERS),
  links: external_exports.array(CrossRepoLinkSchema).max(MAX_CROSS_REPO_LINKS).default([])
});
var LocationValueSchema = external_exports.string().min(1).max(4e3).refine((value) => !posix.isAbsolute(value) && !win32.isAbsolute(value), "must be relative to the workspace root");
var WorkspaceLocationsSchema = external_exports.object({
  version: external_exports.literal(1),
  locations: external_exports.record(UuidSchema, LocationValueSchema).default({})
});
var issueLines = (error) => error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
function validateWorkspaceFile(data) {
  const parsed = WorkspaceFileSchema.safeParse(data);
  if (!parsed.success) return { ok: false, errors: issueLines(parsed.error) };
  const value = parsed.data;
  const errors = [];
  const memberIds = /* @__PURE__ */ new Set();
  const aliases = /* @__PURE__ */ new Set();
  for (const member of value.members) {
    if (memberIds.has(member.repositoryId)) errors.push(`Duplicate member repositoryId: ${member.repositoryId}`);
    if (aliases.has(member.alias)) errors.push(`Duplicate member alias: ${member.alias}`);
    memberIds.add(member.repositoryId);
    aliases.add(member.alias);
  }
  const linkIds = /* @__PURE__ */ new Set();
  for (const link of value.links) {
    if (linkIds.has(link.id)) errors.push(`Duplicate cross-link id: ${link.id}`);
    linkIds.add(link.id);
    if (!memberIds.has(link.source.repositoryId)) errors.push(`Link "${link.id}" source references unknown repositoryId "${link.source.repositoryId}"`);
    if (!memberIds.has(link.target.repositoryId)) errors.push(`Link "${link.id}" target references unknown repositoryId "${link.target.repositoryId}"`);
    if (link.source.repositoryId === link.target.repositoryId) errors.push(`Link "${link.id}" must connect different repositories`);
    for (const evidence of link.evidence ?? []) {
      if (!memberIds.has(evidence.repositoryId)) errors.push(`Link "${link.id}" evidence references unknown repositoryId "${evidence.repositoryId}"`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
function validateWorkspaceLocations(data) {
  const parsed = WorkspaceLocationsSchema.safeParse(data);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, errors: issueLines(parsed.error) };
}

// src/core/workspace-store.ts
var workspaceDir = (root) => join9(root, ".visflow-workspace");
var workspaceFilePath = (root) => join9(workspaceDir(root), "workspace.json");
var locationsFilePath = (root) => join9(workspaceDir(root), "locations.json");
function readWorkspaceFile(root) {
  let raw;
  try {
    raw = readFileSync8(workspaceFilePath(root), "utf8");
  } catch {
    return { ok: false, reason: "missing", errors: ["No .visflow-workspace/workspace.json found."] };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: "invalid-json", errors: [error.message] };
  }
  const result = validateWorkspaceFile(data);
  return result.ok ? { ok: true, value: result.value, raw } : { ok: false, reason: "invalid-schema", errors: result.errors };
}
function readWorkspaceLocations(root) {
  let raw;
  try {
    raw = readFileSync8(locationsFilePath(root), "utf8");
  } catch {
    return { ok: true, value: { version: 1, locations: {} }, raw: null };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: "invalid-json", errors: [error.message] };
  }
  const result = validateWorkspaceLocations(data);
  return result.ok ? { ok: true, value: result.value, raw } : { ok: false, reason: "invalid-schema", errors: result.errors };
}
function writeWorkspaceFile(root, value) {
  const checked = validateWorkspaceFile(value);
  if (!checked.ok) throw new Error(`Invalid workspace: ${checked.errors.join("; ")}`);
  writeJsonAtomic(workspaceFilePath(root), checked.value);
}

// src/core/workspace-load.ts
var inside = isPathInside;
function memberDiagnostic(member, status, detail) {
  switch (status) {
    case "ready":
      return void 0;
    case "unlocated":
      return `Repository "${member.alias}" is not located. Run visflow workspace locate ${member.alias} <path>.`;
    case "missing":
      return `Repository "${member.alias}" is missing. Run visflow workspace locate ${member.alias} <path>.`;
    case "identity-mismatch":
      return `Repository "${member.alias}" has a missing or mismatched repository identity.${detail ? ` ${detail}` : ""}`;
    case "unmapped":
      return `Repository "${member.alias}" has no VisFlow map. Run /visflow:init inside that repository.`;
    case "invalid-graph":
      return `Repository "${member.alias}" has an invalid graph.${detail ? ` ${detail}` : ""}`;
    case "invalid-decisions":
      return `Repository "${member.alias}" has invalid decisions.${detail ? ` ${detail}` : ""}`;
  }
}
function loadWorkspace(root) {
  const stored = readWorkspaceFile(root);
  if (!stored.ok) {
    return {
      ok: false,
      error: { kind: stored.reason === "missing" ? "not-found" : "invalid", messages: stored.errors }
    };
  }
  const locations = readWorkspaceLocations(root);
  if (!locations.ok) return { ok: false, error: { kind: "invalid", messages: locations.errors } };
  const roots = /* @__PURE__ */ new Map();
  for (const member of stored.value.members) {
    const location = locations.value.locations[member.repositoryId];
    if (!location) continue;
    const candidate = resolve(root, location);
    if (!existsSync2(candidate)) continue;
    try {
      roots.set(member.repositoryId, realpathSync2(candidate));
    } catch {
    }
  }
  const rooted = stored.value.members.map((member) => ({ member, real: roots.get(member.repositoryId) })).filter((entry) => !!entry.real);
  for (let i = 0; i < rooted.length; i++) {
    for (let j = i + 1; j < rooted.length; j++) {
      if (inside(rooted[i].real, rooted[j].real) || inside(rooted[j].real, rooted[i].real)) {
        return {
          ok: false,
          error: {
            kind: "security",
            messages: [`Workspace member roots overlap: "${rooted[i].member.alias}" and "${rooted[j].member.alias}".`]
          }
        };
      }
    }
  }
  const members = stored.value.members.map((member) => {
    const location = locations.value.locations[member.repositoryId];
    if (!location) return { member, status: "unlocated", diagnostic: memberDiagnostic(member, "unlocated") };
    const repoRoot = roots.get(member.repositoryId);
    if (!repoRoot) return { member, status: "missing", diagnostic: memberDiagnostic(member, "missing") };
    const config = readRepositoryConfig(repoRoot);
    if (!config.ok || config.config.repositoryId !== member.repositoryId) {
      return {
        member,
        status: "identity-mismatch",
        diagnostic: memberDiagnostic(member, "identity-mismatch")
      };
    }
    const loaded = loadGraph(repoRoot);
    if (!loaded.ok) {
      const status = loaded.error.kind === "not-found" ? "unmapped" : "invalid-graph";
      return {
        member,
        status,
        diagnostic: memberDiagnostic(member, status, loaded.error.messages[0])
      };
    }
    let decisions;
    try {
      decisions = readDecisions(repoRoot);
    } catch (error) {
      const detail = error instanceof DecisionsInvalidError ? error.message.split("\n")[0] : "Could not read decisions.";
      return {
        member,
        status: "invalid-decisions",
        diagnostic: memberDiagnostic(member, "invalid-decisions", detail)
      };
    }
    return {
      member,
      status: "ready",
      repoRoot,
      graph: loaded.graph,
      graphRaw: loaded.raw,
      decisions,
      meta: readMetaOrNull(repoRoot)
    };
  });
  const byId = new Map(members.map((member) => [member.member.repositoryId, member]));
  const links = stored.value.links.map((link) => {
    const source = byId.get(link.source.repositoryId);
    const target = byId.get(link.target.repositoryId);
    let status;
    if (source?.status !== "ready") status = "source-unavailable";
    else if (target?.status !== "ready") status = "target-unavailable";
    else if (!source.graph?.nodes.some((node) => node.id === link.source.nodeId)) status = "source-node-missing";
    else if (!target.graph?.nodes.some((node) => node.id === link.target.nodeId)) status = "target-node-missing";
    else status = "resolved";
    return { link, status };
  });
  return {
    ok: true,
    workspace: { root, file: stored.value, fileRaw: stored.raw, members, links }
  };
}

// src/workspace-reconcile/boundary-index.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync3, readFileSync as readFileSync9, realpathSync as realpathSync3, statSync as statSync3 } from "node:fs";
import { isAbsolute as isAbsolute2, join as join10, posix as posix2, resolve as resolve2, win32 as win322 } from "node:path";

// src/schema/boundary-schema.ts
var BOUNDARY_KINDS = [
  "package",
  "http",
  "schema",
  "event",
  "deployment",
  "artifact"
];
var MAX_BOUNDARY_FACTS = 8192;
var MAX_BOUNDARY_EVIDENCE = 16;
var MAX_BOUNDARY_FILES = 16384;
var EvidenceSchema = external_exports.object({
  path: external_exports.string().min(1).max(4e3).refine(isSafeWorkspaceRelativePath, "must be a repository-relative path"),
  detail: external_exports.string().max(4e3).optional()
});
var BoundaryFactSchema = external_exports.object({
  id: external_exports.string().regex(/^[a-f0-9]{64}$/),
  kind: external_exports.enum(BOUNDARY_KINDS),
  direction: external_exports.enum(["consumes", "provides"]),
  key: external_exports.string().min(1).max(1e3),
  nodeId: external_exports.string().min(1).max(1e3),
  evidence: external_exports.array(EvidenceSchema).min(1).max(MAX_BOUNDARY_EVIDENCE)
});
var BoundaryFileCacheSchema = external_exports.object({
  hash: external_exports.string().regex(/^[a-f0-9]{64}$/),
  nodeId: external_exports.string().min(1).max(1e3),
  facts: external_exports.array(BoundaryFactSchema).max(MAX_BOUNDARY_FACTS)
});
var BoundaryIndexSchema = external_exports.object({
  version: external_exports.literal(1),
  repositoryId: external_exports.string().uuid(),
  graphHash: external_exports.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: external_exports.string().datetime(),
  facts: external_exports.array(BoundaryFactSchema).max(MAX_BOUNDARY_FACTS),
  fingerprint: external_exports.string().regex(/^[a-f0-9]{64}$/),
  files: external_exports.record(BoundaryFileCacheSchema).optional(),
  diagnostics: external_exports.array(external_exports.string().max(4e3)).max(256).optional(),
  truncated: external_exports.boolean().optional()
});
function validateBoundaryIndex(data) {
  const parsed = BoundaryIndexSchema.safeParse(data);
  if (!parsed.success) return {
    ok: false,
    errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
  };
  const ids = /* @__PURE__ */ new Set();
  const errors = [];
  for (const fact of parsed.data.facts) {
    if (ids.has(fact.id)) errors.push(`Duplicate boundary fact id: ${fact.id}`);
    ids.add(fact.id);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: parsed.data };
}

// src/workspace-reconcile/extractors/shared.ts
import { createHash } from "node:crypto";
var hashText = (value) => createHash("sha256").update(value).digest("hex");
var normalizeKey = (kind, value) => `${kind}:${value.trim().toLowerCase().replace(/\s+/g, " ")}`;
var rawFact = (kind, direction, key, detail) => ({ kind, direction, key: normalizeKey(kind, key), ...detail ? { detail } : {} });
function uniqueFacts(facts) {
  const seen = /* @__PURE__ */ new Set();
  return facts.filter((fact) => {
    const key = JSON.stringify([fact.kind, fact.direction, fact.key, fact.detail ?? ""]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// src/workspace-reconcile/extractors/package.ts
var builtin = /* @__PURE__ */ new Set([
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "os",
  "path",
  "stream",
  "timers",
  "url",
  "util",
  "worker_threads",
  "zlib"
]);
function packageRoot(specifier) {
  const clean = specifier.replace(/^node:/, "");
  if (!clean || clean.startsWith(".") || clean.startsWith("/") || builtin.has(clean.split("/")[0])) return null;
  if (clean.startsWith("@")) {
    const [scope, name] = clean.split("/");
    return scope && name ? `${scope}/${name}` : null;
  }
  return clean.split("/")[0] || null;
}
var extractPackageFacts = (path, contents) => {
  const facts = [];
  if (/(^|\/)package\.json$/.test(path)) {
    try {
      const pkg = JSON.parse(contents);
      if (typeof pkg.name === "string" && pkg.name.trim()) {
        facts.push(rawFact("package", "provides", `npm:${pkg.name}`, `declares npm package ${pkg.name}`));
      }
      for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
        const deps = pkg[field];
        if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue;
        for (const name of Object.keys(deps)) {
          facts.push(rawFact("package", "consumes", `npm:${name}`, `${field} includes ${name}`));
        }
      }
    } catch {
    }
  }
  const importPattern = /(?:\bfrom\s*|\brequire\s*\(|\bimport\s*\()\s*['"]([^'"]+)['"]/g;
  for (const match of contents.matchAll(importPattern)) {
    const name = packageRoot(match[1]);
    if (name) facts.push(rawFact("package", "consumes", `npm:${name}`, `imports ${match[1]}`));
  }
  for (const match of contents.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) {
    const name = packageRoot(match[1]);
    if (name) facts.push(rawFact("package", "consumes", `npm:${name}`, `imports ${match[1]}`));
  }
  return uniqueFacts(facts);
};

// src/workspace-reconcile/extractors/http.ts
var normalizePath = (value) => {
  let path = value.trim();
  path = path.replace(/^\$\{[^}]+\}/, "");
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  if (!path.startsWith("/")) return null;
  path = path.split(/[?#]/)[0].replace(/\$\{[^}]+\}/g, ":param").replace(/:[A-Za-z_][\w-]*/g, ":param").replace(/\{[^}]+\}/g, ":param").replace(/\/+/g, "/");
  return path.length > 1 ? path.replace(/\/$/, "") : path;
};
var extractHttpFacts = (_path, contents) => {
  const facts = [];
  const route = /\b(?:app|router|server)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  for (const match of contents.matchAll(route)) {
    const path = normalizePath(match[2]);
    if (path) facts.push(rawFact("http", "provides", `${match[1].toUpperCase()} ${path}`, `declares ${match[1].toUpperCase()} ${match[2]}`));
  }
  const decorator = /@(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/gi;
  for (const match of contents.matchAll(decorator)) {
    const path = normalizePath("/" + match[2].replace(/^\//, ""));
    if (path) facts.push(rawFact("http", "provides", `${match[1].toUpperCase()} ${path}`, `declares @${match[1]}(${match[2]})`));
  }
  const simpleClient = /\b(?:fetch|axios\s*\.\s*(get|post|put|patch|delete)|client\s*\.\s*(get|post|put|patch|delete))\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  for (const match of contents.matchAll(simpleClient)) {
    const method = (match[1] ?? match[2] ?? "GET").toUpperCase();
    const value = match[3];
    const path = normalizePath(value);
    if (path) facts.push(rawFact("http", "consumes", `${method} ${path}`, `calls ${method} ${value}`));
  }
  return uniqueFacts(facts);
};

// src/workspace-reconcile/extractors/schema.ts
import { basename as basename2 } from "node:path";
var extractSchemaFacts = (path, contents) => {
  const facts = [];
  if (path.endsWith(".proto")) {
    facts.push(rawFact("schema", "provides", `protobuf:${basename2(path)}`, `defines ${basename2(path)}`));
    for (const match of contents.matchAll(/\bimport\s+['"]([^'"]+\.proto)['"]/g)) {
      facts.push(rawFact("schema", "consumes", `protobuf:${basename2(match[1])}`, `imports ${match[1]}`));
    }
  }
  if (/openapi|swagger/i.test(path)) {
    const title = contents.match(/(?:"title"\s*:\s*"|^\s*title\s*:\s*)([^"\n]+)/m)?.[1]?.trim();
    if (title) facts.push(rawFact("schema", "provides", `openapi:${title}`, `declares OpenAPI ${title}`));
  }
  return uniqueFacts(facts);
};

// src/workspace-reconcile/extractors/event.ts
var extractEventFacts = (_path, contents) => {
  const facts = [];
  for (const match of contents.matchAll(/\b(?:publish|emit|sendToQueue)\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
    facts.push(rawFact("event", "provides", `event:${match[1]}`, `publishes ${match[1]}`));
  }
  for (const match of contents.matchAll(/\b(?:subscribe|consume|addEventListener)\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
    facts.push(rawFact("event", "consumes", `event:${match[1]}`, `subscribes to ${match[1]}`));
  }
  return uniqueFacts(facts);
};

// src/workspace-reconcile/extractors/deployment.ts
var extractDeploymentFacts = (path, contents) => {
  if (!/\.(?:ya?ml|tf|json)$|Dockerfile$/i.test(path)) return [];
  const facts = [];
  for (const match of contents.matchAll(/^\s*(?:service|name)\s*:\s*['"]?([a-z0-9][\w.-]+)['"]?\s*$/gim)) {
    facts.push(rawFact("deployment", "provides", `service:${match[1]}`, `declares service ${match[1]}`));
  }
  for (const match of contents.matchAll(/^\s*(?:depends_on\s*:\s*|serviceName\s*:\s*|host\s*:\s*)['"]?([a-z0-9][\w.-]+)['"]?\s*$/gim)) {
    facts.push(rawFact("deployment", "consumes", `service:${match[1]}`, `references service ${match[1]}`));
  }
  return uniqueFacts(facts);
};

// src/workspace-reconcile/extractors/artifact.ts
var cleanImage = (value) => value.trim().replace(/@sha256:[a-f0-9]+$/i, "").replace(/:[^/:]+$/, "");
var extractArtifactFacts = (path, contents) => {
  const facts = [];
  if (/Dockerfile$/i.test(path)) {
    for (const match of contents.matchAll(/^\s*FROM\s+([^\s]+)(?:\s+AS\s+\S+)?/gim)) {
      facts.push(rawFact("artifact", "consumes", `container:${cleanImage(match[1])}`, `uses image ${match[1]}`));
    }
  }
  for (const match of contents.matchAll(/^\s*image\s*:\s*['"]?([^\s'"]+)['"]?\s*$/gim)) {
    facts.push(rawFact("artifact", "consumes", `container:${cleanImage(match[1])}`, `uses image ${match[1]}`));
  }
  const produced = contents.match(/^\s*(?:imageName|repository)\s*[:=]\s*['"]?([^\s'"]+)['"]?\s*$/im)?.[1];
  if (produced) facts.push(rawFact("artifact", "provides", `container:${cleanImage(produced)}`, `publishes image ${produced}`));
  return uniqueFacts(facts);
};

// src/workspace-reconcile/boundary-index.ts
var BOUNDARY_INDEX_FILE = "boundary-index.json";
var boundaryIndexPath = (repoRoot) => join10(repoRoot, ".visflow", BOUNDARY_INDEX_FILE);
var DEFAULT_BOUNDARY_FILE_CAP_BYTES = 512 * 1024;
var DEFAULT_EXTRACTORS = [
  extractPackageFacts,
  extractHttpFacts,
  extractSchemaFacts,
  extractEventFacts,
  extractDeploymentFacts,
  extractArtifactFacts
];
var canonicalHash = (value) => createHash2("sha256").update(JSON.stringify(value)).digest("hex");
var safeRelative = (path) => {
  if (!path || isAbsolute2(path) || posix2.isAbsolute(path) || win322.isAbsolute(path)) return false;
  const normalized = posix2.normalize(path.replaceAll("\\", "/"));
  return normalized !== "." && normalized !== ".." && !normalized.startsWith("../");
};
var containedRealPath = (repoRoot, rel) => {
  try {
    const root = realpathSync3(repoRoot);
    const file = realpathSync3(resolve2(root, rel));
    return isPathInside(root, file) ? file : null;
  } catch {
    return null;
  }
};
function readBoundaryIndex(repoRoot) {
  let raw;
  try {
    raw = readFileSync9(boundaryIndexPath(repoRoot), "utf8");
  } catch {
    return { ok: false, reason: "missing", errors: ["No .visflow/boundary-index.json found."] };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: "invalid-json", errors: [error.message] };
  }
  const checked = validateBoundaryIndex(data);
  return checked.ok ? { ok: true, value: checked.value, raw } : { ok: false, reason: "invalid-schema", errors: checked.errors };
}
function materializeFact(nodeId, path, raw) {
  const evidence = [{ path, ...raw.detail ? { detail: raw.detail } : {} }];
  const identity = { kind: raw.kind, direction: raw.direction, key: raw.key, nodeId, evidence };
  return { id: canonicalHash(identity), ...identity };
}
var factOrder = (left, right) => left.kind.localeCompare(right.kind) || left.key.localeCompare(right.key) || left.direction.localeCompare(right.direction) || left.nodeId.localeCompare(right.nodeId) || left.id.localeCompare(right.id);
function refreshBoundaryIndex(repoRoot, opts = {}) {
  const config = readRepositoryConfig(repoRoot);
  if (!config.ok || !config.config.repositoryId) return { ok: false, reason: "repository identity unavailable" };
  const loaded = loadGraph(repoRoot);
  if (!loaded.ok) return { ok: false, reason: `graph unavailable: ${loaded.error.kind}` };
  const graphHash = hashText(loaded.raw);
  const previous = readBoundaryIndex(repoRoot);
  const previousFiles = previous.ok ? previous.value.files ?? {} : {};
  const diagnostics = [];
  const owners = /* @__PURE__ */ new Map();
  for (const node of loaded.graph.nodes) {
    for (const original of node.files) {
      const path = posix2.normalize(original.replaceAll("\\", "/"));
      if (!safeRelative(path)) {
        diagnostics.push(`ignored unsafe graph path: ${original}`);
        continue;
      }
      if (owners.has(path) && owners.get(path) !== node.id) owners.set(path, null);
      else owners.set(path, node.id);
    }
  }
  if (!owners.has("package.json") && existsSync3(join10(repoRoot, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync9(join10(repoRoot, "package.json"), "utf8"));
      const entries = [];
      const collect = (value) => {
        if (typeof value === "string") entries.push(posix2.normalize(value.replace(/^\.\//, "")));
        else if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === "object") Object.values(value).forEach(collect);
      };
      collect(pkg.main);
      collect(pkg.module);
      collect(pkg.types);
      collect(pkg.bin);
      collect(pkg.exports);
      const entryOwners = new Set(entries.map((entry) => owners.get(entry)).filter((owner) => typeof owner === "string"));
      if (entryOwners.size === 1) owners.set("package.json", [...entryOwners][0]);
      else if (loaded.graph.nodes.length === 1) owners.set("package.json", loaded.graph.nodes[0].id);
      else if (typeof pkg.name === "string") diagnostics.push(`package.json is unowned; package boundary ${pkg.name} was not indexed`);
    } catch {
      diagnostics.push("package.json is unreadable or invalid; package boundary was not indexed");
    }
  }
  const files = {};
  const facts = [];
  const extractors = opts.extractors ?? DEFAULT_EXTRACTORS;
  let truncated = false;
  for (const [path, nodeId] of [...owners.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (Object.keys(files).length >= MAX_BOUNDARY_FILES) {
      truncated = true;
      break;
    }
    if (nodeId === null) {
      diagnostics.push(`ignored ambiguously owned file: ${path}`);
      continue;
    }
    const real = containedRealPath(repoRoot, path);
    if (!real) {
      diagnostics.push(`ignored missing or out-of-repository file: ${path}`);
      continue;
    }
    let contents;
    try {
      if (statSync3(real).size > (opts.fileCapBytes ?? DEFAULT_BOUNDARY_FILE_CAP_BYTES)) {
        diagnostics.push(`ignored oversized boundary file: ${path}`);
        continue;
      }
      contents = readFileSync9(real, "utf8");
    } catch {
      diagnostics.push(`ignored unreadable boundary file: ${path}`);
      continue;
    }
    const hash2 = hashText(contents);
    const cached = previousFiles[path];
    const fileFacts = cached?.hash === hash2 && cached.nodeId === nodeId ? cached.facts : extractors.flatMap((extractor) => extractor(path, contents)).map((fact) => materializeFact(nodeId, path, fact));
    files[path] = { hash: hash2, nodeId, facts: fileFacts };
    for (const fact of fileFacts) {
      if (facts.length >= MAX_BOUNDARY_FACTS) {
        truncated = true;
        break;
      }
      facts.push(fact);
    }
    if (truncated) break;
  }
  facts.sort(factOrder);
  const fingerprint2 = canonicalHash(facts.map(({ id: _id, ...fact }) => fact));
  const index = {
    version: 1,
    repositoryId: config.config.repositoryId,
    graphHash,
    generatedAt: (opts.now ?? (() => (/* @__PURE__ */ new Date()).toISOString()))(),
    facts,
    fingerprint: fingerprint2,
    ...Object.keys(files).length ? { files } : {},
    ...diagnostics.length ? { diagnostics: diagnostics.slice(0, 256) } : {},
    ...truncated ? { truncated: true } : {}
  };
  const checked = validateBoundaryIndex(index);
  if (!checked.ok) return { ok: false, reason: `invalid boundary index: ${checked.errors.join("; ")}` };
  return withSyncMicroLock(join10(repoRoot, ".visflow", ".boundary-lock"), () => {
    const current = loadGraph(repoRoot);
    if (!current.ok) return { ok: false, reason: `graph unavailable: ${current.error.kind}` };
    if (hashText(current.raw) !== graphHash) return { ok: false, reason: "graph changed during boundary refresh" };
    const latest = readBoundaryIndex(repoRoot);
    const unchanged = latest.ok && latest.value.repositoryId === index.repositoryId && latest.value.graphHash === graphHash && latest.value.fingerprint === fingerprint2 && Boolean(latest.value.truncated) === Boolean(index.truncated) && JSON.stringify(latest.value.diagnostics ?? []) === JSON.stringify(index.diagnostics ?? []);
    if (unchanged) return { ok: true, index: latest.value, changed: false };
    writeJsonAtomic(boundaryIndexPath(repoRoot), index);
    return { ok: true, index, changed: true };
  });
}

// src/workspace-reconcile/candidates.ts
import { createHash as createHash3, randomUUID as randomUUID2 } from "node:crypto";

// src/schema/candidate-schema.ts
var MAX_WORKSPACE_CANDIDATES = 4096;
var MAX_CANDIDATE_EVIDENCE = 32;
var RefSchema = external_exports.object({
  repositoryId: external_exports.string().uuid(),
  nodeId: external_exports.string().min(1).max(1e3)
});
var EvidenceSchema2 = external_exports.object({
  repositoryId: external_exports.string().uuid(),
  path: external_exports.string().min(1).max(4e3).refine(isSafeWorkspaceRelativePath),
  detail: external_exports.string().max(4e3).optional()
});
var CrossRepoCandidateSchema = external_exports.object({
  id: external_exports.string().uuid(),
  fingerprint: external_exports.string().regex(/^[a-f0-9]{64}$/),
  kind: external_exports.enum(BOUNDARY_KINDS),
  source: RefSchema,
  target: RefSchema,
  evidence: external_exports.array(EvidenceSchema2).min(1).max(MAX_CANDIDATE_EVIDENCE),
  confidence: external_exports.enum(["high", "medium", "low"]),
  explanation: external_exports.string().min(1).max(4e3),
  status: external_exports.enum(["pending", "dismissed"]),
  firstSeenAt: external_exports.string().datetime(),
  lastSeenAt: external_exports.string().datetime()
});
var CandidateStoreSchema = external_exports.object({
  version: external_exports.literal(1),
  candidates: external_exports.array(CrossRepoCandidateSchema).max(MAX_WORKSPACE_CANDIDATES).default([])
});
function validateCandidateStore(data) {
  const parsed = CandidateStoreSchema.safeParse(data);
  if (!parsed.success) return {
    ok: false,
    errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
  };
  const ids = /* @__PURE__ */ new Set();
  const fingerprints = /* @__PURE__ */ new Set();
  const errors = [];
  for (const candidate of parsed.data.candidates) {
    if (ids.has(candidate.id)) errors.push(`Duplicate candidate id: ${candidate.id}`);
    if (fingerprints.has(candidate.fingerprint)) errors.push(`Duplicate candidate fingerprint: ${candidate.fingerprint}`);
    ids.add(candidate.id);
    fingerprints.add(candidate.fingerprint);
    if (candidate.source.repositoryId === candidate.target.repositoryId) {
      errors.push(`Candidate ${candidate.id} must cross repositories.`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: parsed.data };
}

// src/workspace-reconcile/candidate-store.ts
import { readFileSync as readFileSync10 } from "node:fs";
import { join as join11 } from "node:path";
var candidatesPath = (workspaceRoot) => join11(workspaceDir(workspaceRoot), "candidates.json");
function readCandidateStore(workspaceRoot) {
  let raw;
  try {
    raw = readFileSync10(candidatesPath(workspaceRoot), "utf8");
  } catch {
    return { ok: true, value: { version: 1, candidates: [] }, raw: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
  const checked = validateCandidateStore(parsed);
  return checked.ok ? { ok: true, value: checked.value, raw } : checked;
}
function writeCandidateStore(workspaceRoot, store) {
  const checked = validateCandidateStore(store);
  if (!checked.ok) throw new Error(`Invalid workspace candidates: ${checked.errors.join("; ")}`);
  writeJsonAtomic(candidatesPath(workspaceRoot), checked.value);
}
function mergeCandidateStore(previous, discovered, opts) {
  const byFingerprint = new Map(previous.candidates.map((candidate) => [candidate.fingerprint, candidate]));
  const next = [];
  for (const item of discovered) {
    const existing = byFingerprint.get(item.fingerprint);
    next.push(existing ? { ...item, id: existing.id, status: existing.status, firstSeenAt: existing.firstSeenAt, lastSeenAt: opts.now } : { ...item, id: opts.createId(), status: "pending", firstSeenAt: opts.now, lastSeenAt: opts.now });
  }
  for (const candidate of previous.candidates) {
    if (candidate.status === "dismissed" && !next.some((item) => item.fingerprint === candidate.fingerprint)) {
      next.push(candidate);
    }
  }
  return { version: 1, candidates: next.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)) };
}

// src/workspace-reconcile/candidates.ts
import { createHash as hash } from "node:crypto";
var fingerprint = (value) => createHash3("sha256").update(JSON.stringify(value)).digest("hex");
var evidenceFor = (fact) => fact.evidence.map((evidence) => ({
  repositoryId: fact.repositoryId,
  path: evidence.path,
  ...evidence.detail ? { detail: evidence.detail } : {}
}));
var refFor = (fact) => ({
  repositoryId: fact.repositoryId,
  nodeId: fact.nodeId
});
var evidenceKey = (evidence) => JSON.stringify([evidence.repositoryId, evidence.path, evidence.detail ?? ""]);
function confidence(kind, providerCount, consumerCount) {
  if (providerCount > 1 || consumerCount > 16) return "low";
  if (kind === "event" || kind === "deployment") return "medium";
  return "high";
}
function joinBoundaryCandidates(indexes) {
  const buckets = /* @__PURE__ */ new Map();
  const aggregated = /* @__PURE__ */ new Map();
  const diagnostics = [];
  for (const index of indexes) {
    if (index.truncated) diagnostics.push(`Boundary index for ${index.repositoryId} was truncated.`);
    for (const fact of index.facts) {
      const identity = JSON.stringify([index.repositoryId, fact.nodeId, fact.kind, fact.direction, fact.key]);
      const existing = aggregated.get(identity);
      if (!existing) aggregated.set(identity, { ...fact, repositoryId: index.repositoryId });
      else existing.evidence = [...existing.evidence, ...fact.evidence].filter((item, position, all) => all.findIndex((other) => other.path === item.path && (other.detail ?? "") === (item.detail ?? "")) === position);
    }
  }
  for (const fact of aggregated.values()) {
    const bucket = buckets.get(fact.key) ?? [];
    bucket.push(fact);
    buckets.set(fact.key, bucket);
  }
  const candidates = /* @__PURE__ */ new Map();
  let truncated = false;
  let candidateCapReached = false;
  for (const [key, facts] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const consumers = facts.filter((fact) => fact.direction === "consumes");
    const providers = facts.filter((fact) => fact.direction === "provides");
    for (const consumer of consumers) {
      for (const provider of providers) {
        if (consumer.repositoryId === provider.repositoryId) continue;
        const source = refFor(consumer);
        const target = refFor(provider);
        const allEvidence = [...evidenceFor(consumer), ...evidenceFor(provider)].filter((item, index, all) => all.findIndex((other) => evidenceKey(other) === evidenceKey(item)) === index).sort((a, b) => evidenceKey(a).localeCompare(evidenceKey(b)));
        if (allEvidence.length > MAX_CANDIDATE_EVIDENCE) truncated = true;
        const evidence = allEvidence.slice(0, MAX_CANDIDATE_EVIDENCE);
        const identity = { kind: consumer.kind, source, target, evidence };
        const fp = fingerprint(identity);
        const existing = candidates.get(fp);
        if (existing) continue;
        if (candidates.size >= MAX_WORKSPACE_CANDIDATES) {
          truncated = true;
          candidateCapReached = true;
          break;
        }
        candidates.set(fp, {
          fingerprint: fp,
          kind: consumer.kind,
          source,
          target,
          evidence,
          confidence: confidence(consumer.kind, providers.length, consumers.length),
          explanation: `${consumer.nodeId} consumes ${key}; ${provider.nodeId} provides it.`
        });
      }
      if (candidateCapReached) break;
    }
    if (candidateCapReached) break;
  }
  if (truncated) diagnostics.push(`Candidate results were truncated at ${MAX_WORKSPACE_CANDIDATES}.`);
  return { candidates: [...candidates.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)), truncated, diagnostics };
}
function loadFreshIndexes(workspace, refresh) {
  const indexes = [];
  const diagnostics = [];
  for (const member of workspace.members) {
    if (member.status !== "ready" || !member.repoRoot || !member.graphRaw) {
      diagnostics.push(`${member.member.alias}: member is ${member.status}`);
      continue;
    }
    if (refresh) refreshBoundaryIndex(member.repoRoot);
    const index = readBoundaryIndex(member.repoRoot);
    const graphHash = hash("sha256").update(member.graphRaw).digest("hex");
    if (!index.ok || index.value.repositoryId !== member.member.repositoryId || index.value.graphHash !== graphHash) {
      diagnostics.push(`${member.member.alias}: boundary index is missing or stale`);
      continue;
    }
    indexes.push(index.value);
  }
  return { indexes, diagnostics };
}
function collectWorkspaceBoundaryCandidates(workspaceRoot, opts = {}) {
  const loaded = loadWorkspace(workspaceRoot);
  if (!loaded.ok) return { ok: false, reason: loaded.error.messages.join("; ") };
  const scoped = opts.eligibleRepositoryIds ? {
    ...loaded.workspace,
    members: loaded.workspace.members.map((member) => opts.eligibleRepositoryIds.has(member.member.repositoryId) ? member : { ...member, status: "unlocated", graph: void 0, graphRaw: void 0, repoRoot: void 0 })
  } : loaded.workspace;
  const fresh = loadFreshIndexes(scoped, opts.refreshBoundary !== false);
  return {
    ok: true,
    workspace: loaded.workspace,
    joined: joinBoundaryCandidates(fresh.indexes),
    diagnostics: fresh.diagnostics
  };
}
async function persistWorkspaceCandidates(workspaceRoot, discovered, opts = {}) {
  return withStateLock(workspaceDir(workspaceRoot), () => {
    const loaded = loadWorkspace(workspaceRoot);
    if (!loaded.ok) return { ok: false, reason: loaded.error.messages.join("; ") };
    const state = readCandidateStore(workspaceRoot);
    if (!state.ok) return { ok: false, reason: `candidate state is invalid: ${state.errors.join("; ")}` };
    const existingPairs = new Set(loaded.workspace.file.links.map((link) => JSON.stringify([
      link.source.repositoryId,
      link.source.nodeId,
      link.target.repositoryId,
      link.target.nodeId
    ])));
    const netNew = discovered.filter((candidate) => !existingPairs.has(JSON.stringify([
      candidate.source.repositoryId,
      candidate.source.nodeId,
      candidate.target.repositoryId,
      candidate.target.nodeId
    ])));
    const now = (opts.now ?? (() => (/* @__PURE__ */ new Date()).toISOString()))();
    const store = mergeCandidateStore(state.value, netNew, {
      now,
      createId: opts.createId ?? randomUUID2
    });
    writeCandidateStore(workspaceRoot, store);
    const fingerprints = new Set(netNew.map((candidate) => candidate.fingerprint));
    return {
      ok: true,
      store,
      discovered: store.candidates.filter((candidate) => fingerprints.has(candidate.fingerprint))
    };
  });
}

// src/workspace-reconcile/review.ts
import { createHash as createHash4 } from "node:crypto";

// src/workspace-reconcile/state.ts
import { join as join12 } from "node:path";

// src/schema/reconcile-state-schema.ts
var MemberFingerprintSchema = external_exports.object({
  graphHash: external_exports.string().regex(/^[a-f0-9]{64}$/),
  boundaryFingerprint: external_exports.string().regex(/^[a-f0-9]{64}$/)
});
var WorkspaceReconcileStateSchema = external_exports.object({
  version: external_exports.literal(1),
  phase: external_exports.enum(["idle", "members", "links", "review", "partial", "error", "cancelled"]),
  members: external_exports.record(external_exports.string().uuid(), MemberFingerprintSchema).default({}),
  pendingCandidates: external_exports.number().int().nonnegative().default(0),
  lastRunAt: external_exports.string().datetime().optional(),
  lastReason: external_exports.string().max(8e3).optional()
});

// src/workspace-reconcile/state.ts
var workspaceReconcileStatePath = (root) => join12(workspaceDir(root), ".reconcile-state.json");
function writeWorkspaceReconcileState(root, state) {
  const parsed = WorkspaceReconcileStateSchema.safeParse(state);
  if (!parsed.success) throw new Error(`Invalid workspace reconcile state: ${parsed.error.message}`);
  writeJsonAtomic(workspaceReconcileStatePath(root), parsed.data);
}

// src/workspace-reconcile/review.ts
function sameEndpoint(left, candidate) {
  return left.source.repositoryId === candidate.source.repositoryId && left.source.nodeId === candidate.source.nodeId && left.target.repositoryId === candidate.target.repositoryId && left.target.nodeId === candidate.target.nodeId;
}
async function reconcileApprovedWorkspaceLinks(workspaceRoot, candidates, expectedWorkspaceRaw, expectedMembers) {
  return withStateLock(workspaceDir(workspaceRoot), () => {
    const current = readWorkspaceFile(workspaceRoot);
    if (!current.ok) return { ok: false, reason: current.errors.join("; ") };
    if (expectedWorkspaceRaw !== void 0 && current.raw !== expectedWorkspaceRaw) {
      return { ok: false, reason: "stale-snapshot" };
    }
    const loaded = loadWorkspace(workspaceRoot);
    if (!loaded.ok) return { ok: false, reason: loaded.error.messages.join("; ") };
    if (expectedMembers) {
      for (const [repositoryId, expected] of Object.entries(expectedMembers)) {
        const member = loaded.workspace.members.find((item) => item.member.repositoryId === repositoryId);
        const boundary = member?.repoRoot ? readBoundaryIndex(member.repoRoot) : void 0;
        const graphHash = member?.graphRaw ? createHash4("sha256").update(member.graphRaw).digest("hex") : void 0;
        if (!member || member.status !== "ready" || graphHash !== expected.graphHash || !boundary?.ok || boundary.value.fingerprint !== expected.boundaryFingerprint || boundary.value.graphHash !== graphHash) return { ok: false, reason: "stale-snapshot" };
      }
    }
    let changed = 0;
    const links = current.value.links.map((link) => {
      if (link.managedBy === "user") return link;
      const exact = candidates.find((candidate) => sameEndpoint(link, candidate));
      if (exact) {
        const next = {
          ...link,
          what: exact.kind,
          why: exact.explanation,
          evidence: exact.evidence
        };
        if (JSON.stringify(next) !== JSON.stringify(link)) changed++;
        return next;
      }
      const resolved = loaded.workspace.links.find((entry) => entry.link.id === link.id)?.status;
      if (resolved !== "source-node-missing" && resolved !== "target-node-missing") return link;
      const sameKind = candidates.filter((candidate) => candidate.kind === link.what);
      const sourceMatches = sameKind.filter((candidate) => candidate.source.repositoryId === link.source.repositoryId && candidate.source.nodeId === link.source.nodeId && candidate.target.repositoryId === link.target.repositoryId);
      const targetMatches = sameKind.filter((candidate) => candidate.target.repositoryId === link.target.repositoryId && candidate.target.nodeId === link.target.nodeId && candidate.source.repositoryId === link.source.repositoryId);
      const replacement = resolved === "target-node-missing" && sourceMatches.length === 1 ? sourceMatches[0] : resolved === "source-node-missing" && targetMatches.length === 1 ? targetMatches[0] : void 0;
      if (!replacement) return link;
      changed++;
      return {
        ...link,
        source: replacement.source,
        target: replacement.target,
        why: replacement.explanation,
        evidence: replacement.evidence
      };
    });
    if (changed > 0) writeWorkspaceFile(workspaceRoot, { ...current.value, links });
    return { ok: true, changed };
  });
}

// src/workspace-reconcile/repository-settle.ts
import { existsSync as existsSync4 } from "node:fs";
import { join as join14 } from "node:path";

// src/llm/run.ts
import { spawn } from "node:child_process";
var DEFAULT_MODEL = "haiku";
function buildClaudeArgs(opts) {
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    opts.model,
    // One-shot scoped passes (C6): everything the pass may see is inlined in the prompt, so the
    // tool loop — each round-trip re-billing the growing context — is dropped entirely.
    // Otherwise, scoped passes read ONLY the projected files: Grep/Glob latitude let a 2-file
    // scoped pass rebuild the whole map at 12x cost (dogfood OBS 1). Full passes legitimately explore.
    "--tools",
    opts.oneShot ? "" : opts.mode === "scoped" ? "Read" : "Read,Grep,Glob",
    "--disallowedTools",
    "Edit",
    "Write",
    "Bash",
    "mcp__*",
    "--permission-mode",
    "dontAsk",
    "--strict-mcp-config",
    "--no-session-persistence",
    // config isolation so the spawned run does NOT re-load our plugin hooks:
    ...opts.byok ? ["--bare"] : ["--safe-mode"]
  ];
}
var DEFAULT_MAX_THINKING_TOKENS = "1024";
function buildClaudeEnv(base, opts = {}) {
  const env = { ...base, VISFLOW_RECONCILING: "1" };
  if (opts.byokKey) env.ANTHROPIC_API_KEY = opts.byokKey;
  const cap = base.VISFLOW_MAX_THINKING_TOKENS || DEFAULT_MAX_THINKING_TOKENS;
  if (cap === "0" || cap.toLowerCase() === "off") delete env.MAX_THINKING_TOKENS;
  else env.MAX_THINKING_TOKENS = cap;
  return env;
}
function parseClaudeEnvelope(stdout) {
  let env;
  try {
    env = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!env || typeof env !== "object") return null;
  return {
    text: typeof env.result === "string" ? env.result : "",
    costUsd: typeof env.total_cost_usd === "number" ? env.total_cost_usd : null,
    isError: env.is_error === true
  };
}
function topLevelObjects(text) {
  const objs = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("{", i);
    if (start < 0) break;
    let depth = 0, end = -1, inStr = false, esc = false;
    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }
    }
    if (end < 0) break;
    objs.push(text.slice(start, end));
    i = end;
  }
  return objs;
}
function extractProposal(text) {
  let last = null;
  let lastSubstantive = null;
  for (const raw of topLevelObjects(text)) {
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object" || !Array.isArray(obj.upsert)) continue;
    const p = {
      upsert: obj.upsert,
      remove: Array.isArray(obj.remove) ? obj.remove : [],
      decisionMoves: Array.isArray(obj.decisionMoves) ? obj.decisionMoves : [],
      groupUpsert: Array.isArray(obj.groupUpsert) ? obj.groupUpsert : []
    };
    last = p;
    if (p.upsert.length > 0 || p.remove.length > 0 || p.decisionMoves.length > 0 || (p.groupUpsert?.length ?? 0) > 0) lastSubstantive = p;
  }
  return lastSubstantive ?? last;
}
function withStderr(reason, stderr, max = 2048) {
  const tail = stderr.trim().slice(-max);
  return tail ? `${reason} | stderr: ${tail}` : reason;
}
function withResultTail(reason, text, max = 800) {
  const tail = text.trim().slice(-max);
  return tail ? `${reason} | result tail: ${tail}` : reason;
}
function parseReconcileTimeoutMs(value) {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const ms = Number(value);
  return Number.isSafeInteger(ms) ? ms : null;
}
var MAX_TIMER_DELAY_MS = 2147483647;
var TERMINATE_GRACE_MS = 2e3;
function scheduleTimeout(fn, delayMs) {
  let remaining = delayMs;
  let timer;
  const scheduleNext = () => {
    const chunk = Math.min(remaining, MAX_TIMER_DELAY_MS);
    timer = setTimeout(() => {
      remaining -= chunk;
      if (remaining > 0) scheduleNext();
      else fn();
    }, chunk);
  };
  scheduleNext();
  return () => {
    if (timer) clearTimeout(timer);
  };
}
function claudeCliRunnerWith(spawnImpl) {
  return (input) => new Promise((resolve3) => {
    if (input.signal?.aborted) {
      resolve3({ ok: false, kind: "cancelled", reason: "claude reconcile cancelled" });
      return;
    }
    const byok = !!input.byokKey;
    const args = buildClaudeArgs({ model: input.model ?? DEFAULT_MODEL, byok, mode: input.mode, oneShot: input.oneShot });
    const env = buildClaudeEnv(process.env, { byokKey: input.byokKey });
    let child;
    try {
      child = spawnImpl("claude", args, { cwd: input.repoRoot, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      resolve3({ ok: false, reason: "claude CLI not found or failed to spawn" });
      return;
    }
    let out = "";
    let err = "";
    let settled = false;
    let closed = false;
    let interruption = null;
    let cancelRunTimeout;
    let cancelKillTimeout;
    const onAbort = () => terminate("cancelled");
    const cleanup = () => {
      cancelRunTimeout?.();
      cancelKillTimeout?.();
      input.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve3(result);
    };
    const terminate = (kind) => {
      if (settled || closed || interruption) return;
      interruption = kind;
      try {
        child.kill("SIGTERM");
      } catch {
      }
      if (!closed) {
        cancelKillTimeout = scheduleTimeout(() => {
          if (closed) return;
          try {
            child.kill("SIGKILL");
          } catch {
          }
        }, TERMINATE_GRACE_MS);
      }
    };
    child.stdout.on("data", (c) => {
      out += c.toString();
    });
    child.stderr.on("data", (c) => {
      err = (err + c.toString()).slice(-4096);
    });
    child.on("error", () => {
      if (!interruption) finish({ ok: false, reason: withStderr("claude CLI not found or failed to spawn", err) });
    });
    child.on("close", () => {
      closed = true;
      if (interruption) {
        const reason = interruption === "cancelled" ? "claude reconcile cancelled" : "claude reconcile timed out";
        finish({ ok: false, kind: interruption, reason: withStderr(reason, err) });
        return;
      }
      const envlp = parseClaudeEnvelope(out);
      if (!envlp || envlp.isError) return finish({ ok: false, reason: withStderr(`claude -p error: ${envlp ? "error subtype" : "unparseable output"}`, err) });
      const proposal = extractProposal(envlp.text);
      if (!proposal) return finish({ ok: false, reason: withStderr(withResultTail("no valid proposal in result", envlp.text), err) });
      finish({ ok: true, proposal, costUsd: envlp.costUsd, raw: out });
    });
    child.stdin.on("error", () => {
      if (!interruption) finish({ ok: false, reason: withStderr("claude exited before reading the prompt (stdin error)", err) });
    });
    input.signal?.addEventListener("abort", onAbort, { once: true });
    const timeoutMs = parseReconcileTimeoutMs(process.env.VISFLOW_RECONCILE_TIMEOUT_MS);
    if (timeoutMs !== null) cancelRunTimeout = scheduleTimeout(() => terminate("timeout"), timeoutMs);
    child.stdin.write(input.prompt);
    child.stdin.end();
  });
}
var claudeCliRunner = claudeCliRunnerWith(spawn);

// src/workspace-reconcile/repository-settle.ts
import { runReconcile, hasPendingReconcileWork } from "../reconcile/index.js";

// src/workspace-reconcile/global-limiter.ts
import { mkdirSync as mkdirSync5, writeFileSync as writeFileSync5 } from "node:fs";
import { join as join13 } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID as randomUUID3 } from "node:crypto";
var sleep2 = (ms) => new Promise((resolve3) => setTimeout(resolve3, ms));
var globalLimiterDir = () => join13(
  tmpdir(),
  `visflow-${typeof process.getuid === "function" ? process.getuid() : "user"}`,
  "model-leases"
);
function globalModelConcurrency(value = process.env.VISFLOW_MODEL_CONCURRENCY) {
  const parsed = value === void 0 ? 2 : Number(value);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(8, parsed)) : 2;
}
async function withGlobalModelLease(fn, opts = {}) {
  const capacity = opts.capacity ?? globalModelConcurrency();
  const dir = opts.dir ?? globalLimiterDir();
  const pollMs = opts.pollMs ?? 50;
  const deadline = Date.now() + (opts.timeoutMs ?? 12e4);
  const staleMs = opts.staleMs ?? 10 * 6e4;
  mkdirSync5(dir, { recursive: true });
  let owned = null;
  while (!owned && Date.now() <= deadline) {
    for (let slot = 0; slot < capacity; slot++) {
      const path = join13(dir, `slot-${slot}`);
      const raw = JSON.stringify({ version: 1, pid: process.pid, token: randomUUID3() });
      try {
        writeFileSync5(path, raw, { flag: "wx" });
        owned = { path, raw };
        break;
      } catch {
        if (isStalePidFile(path, staleMs)) stealPidFile(path);
      }
    }
    if (!owned) await sleep2(pollMs);
  }
  if (!owned) throw new Error("Timed out waiting for a VisFlow model-work slot.");
  const lease = setInterval(() => touchPidFile(owned.path), Math.max(1e3, Math.floor(staleMs / 5)));
  lease.unref();
  try {
    return await fn();
  } finally {
    clearInterval(lease);
    releaseOwnedPidFile(owned.path, owned.raw);
  }
}

// src/workspace-reconcile/repository-settle.ts
var sleep3 = (ms) => new Promise((resolve3) => setTimeout(resolve3, ms));
var guardPath = (repoRoot) => join14(repoRoot, ".visflow", ".reconcile-running");
function repositoryReconcileIsLive(repoRoot) {
  const path = guardPath(repoRoot);
  if (!existsSync4(path)) return false;
  if (isStalePidFile(path, GUARD_TTL_MS)) {
    stealPidFile(path);
    return existsSync4(path);
  }
  return true;
}
async function settleRepository(repoRoot, opts = {}) {
  const run = opts.run ?? runReconcile;
  const baseLlm = opts.llm ?? claudeCliRunner;
  const limitedLlm = (input) => withGlobalModelLease(() => baseLlm(input));
  const deadline = Date.now() + (opts.timeoutMs ?? 12e4);
  const pollMs = opts.pollMs ?? 50;
  let force = opts.force;
  for (; ; ) {
    if (opts.signal?.aborted) return { ok: false, applied: false, reason: "cancelled" };
    const result = await run(repoRoot, { force, llm: limitedLlm, signal: opts.signal });
    if (result.reason !== "already-running") {
      const boundary = refreshBoundaryIndex(repoRoot);
      return boundary.ok ? { ok: true, applied: result.applied, reason: result.reason } : { ok: false, applied: result.applied, reason: `boundary index: ${boundary.reason}` };
    }
    while (repositoryReconcileIsLive(repoRoot) && Date.now() < deadline) {
      if (opts.signal?.aborted) return { ok: false, applied: false, reason: "cancelled" };
      await sleep3(pollMs);
    }
    if (repositoryReconcileIsLive(repoRoot)) return { ok: false, applied: false, reason: "timed out waiting for repository reconciliation" };
    if (!hasPendingReconcileWork(repoRoot)) {
      const boundary = refreshBoundaryIndex(repoRoot);
      return boundary.ok ? { ok: true, applied: false, reason: "settled by another session" } : { ok: false, applied: false, reason: `boundary index: ${boundary.reason}` };
    }
    force = false;
  }
}
async function waitForRepositorySettlement(repoRoot, opts = {}) {
  const deadline = Date.now() + (opts.timeoutMs ?? 12e4);
  const pollMs = opts.pollMs ?? 50;
  while (repositoryReconcileIsLive(repoRoot) && Date.now() < deadline) {
    if (opts.signal?.aborted) return { ok: false, applied: false, reason: "cancelled" };
    await sleep3(pollMs);
  }
  if (repositoryReconcileIsLive(repoRoot)) return { ok: false, applied: false, reason: "timed out waiting for repository reconciliation" };
  if (hasPendingReconcileWork(repoRoot)) return settleRepository(repoRoot, { force: false, signal: opts.signal, timeoutMs: Math.max(0, deadline - Date.now()) });
  const boundary = refreshBoundaryIndex(repoRoot);
  return boundary.ok ? { ok: true, applied: false, reason: "settled" } : { ok: false, applied: false, reason: `boundary index: ${boundary.reason}` };
}

// src/workspace-reconcile/worker-pool.ts
async function runBounded(items, concurrency, worker) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Worker concurrency must be a positive integer.");
  const results = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    for (; ; ) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}
function repositoryConcurrency(value = process.env.VISFLOW_REPO_CONCURRENCY) {
  const parsed = value === void 0 ? 3 : Number(value);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(8, parsed)) : 3;
}

// src/workspace-reconcile/cancel.ts
import { existsSync as existsSync5, readFileSync as readFileSync11, rmSync as rmSync3 } from "node:fs";
import { join as join15 } from "node:path";
var requestPath = (root) => join15(workspaceDir(root), ".reconcile-cancel.json");
function readRequest(root) {
  try {
    const value = JSON.parse(readFileSync11(requestPath(root), "utf8"));
    return value.version === 1 && typeof value.token === "string" && typeof value.requestedAt === "string" ? value : null;
  } catch {
    return null;
  }
}
function watchWorkspaceCancellation(root, token, controller) {
  const poll = () => {
    if (!controller.signal.aborted && readRequest(root)?.token === token) controller.abort("workspace reconciliation cancelled");
  };
  poll();
  const timer = setInterval(poll, 200);
  timer.unref();
  return () => clearInterval(timer);
}
function clearOwnedWorkspaceCancellation(root, token) {
  try {
    if (readRequest(root)?.token === token) rmSync3(requestPath(root), { force: true });
  } catch {
  }
}

// src/workspace-reconcile/requests.ts
import { randomUUID as randomUUID4 } from "node:crypto";
import { readFileSync as readFileSync12, rmSync as rmSync4 } from "node:fs";
import { join as join16 } from "node:path";
var MAX_QUEUED_TRIGGERS = 1024;
var requestPath2 = (root) => join16(workspaceDir(root), ".reconcile-requests.json");
function readFile(root) {
  try {
    const raw = readFileSync12(requestPath2(root), "utf8");
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.requests)) return null;
    const valid = value.requests.every((request) => request && typeof request.id === "string" && typeof request.allMembers === "boolean" && Array.isArray(request.repositoryIds) && request.repositoryIds.every((id) => typeof id === "string") && typeof request.reconcileMembers === "boolean" && typeof request.forceMembers === "boolean");
    return valid ? { value, raw } : null;
  } catch {
    return null;
  }
}
function fromTrigger(trigger) {
  if (trigger.kind === "explicit-sync") return {
    allMembers: trigger.repositoryIds === void 0,
    repositoryIds: trigger.repositoryIds ?? [],
    reconcileMembers: trigger.linksOnly !== true,
    forceMembers: trigger.linksOnly !== true
  };
  return {
    allMembers: false,
    repositoryIds: trigger.dirtyRepositoryIds,
    reconcileMembers: trigger.kind === "session-stop",
    forceMembers: false
  };
}
function merge(requests) {
  return {
    allMembers: requests.some((request) => request.allMembers),
    repositoryIds: [...new Set(requests.flatMap((request) => request.repositoryIds))].sort(),
    reconcileMembers: requests.some((request) => request.reconcileMembers),
    forceMembers: requests.some((request) => request.forceMembers)
  };
}
async function enqueueWorkspaceTrigger(root, trigger) {
  await withStateLock(workspaceDir(root), () => {
    const current = readFile(root)?.value ?? { version: 1, requests: [] };
    const requests = [...current.requests, { id: randomUUID4(), ...fromTrigger(trigger) }].slice(-MAX_QUEUED_TRIGGERS);
    writeJsonAtomic(requestPath2(root), { version: 1, requests });
  });
}
function peekWorkspaceTrigger(root) {
  const request = readFile(root);
  if (!request || request.value.requests.length === 0) return null;
  const value = merge(request.value.requests);
  const repositoryIds = value.allMembers ? void 0 : value.repositoryIds;
  const trigger = value.forceMembers ? { kind: "explicit-sync", repositoryIds, linksOnly: false } : value.reconcileMembers ? { kind: "session-stop", dirtyRepositoryIds: value.repositoryIds } : value.allMembers ? { kind: "explicit-sync", linksOnly: true } : { kind: "member-state-change", dirtyRepositoryIds: value.repositoryIds };
  return { trigger, raw: request.raw };
}
async function completeWorkspaceTrigger(root, expectedRaw) {
  let expected;
  try {
    expected = JSON.parse(expectedRaw);
  } catch {
    return Boolean(peekWorkspaceTrigger(root));
  }
  const covered = new Set(expected.requests.map((request) => request.id));
  return withStateLock(workspaceDir(root), () => {
    const current = readFile(root);
    if (!current) return false;
    const requests = current.value.requests.filter((request) => !covered.has(request.id));
    if (requests.length === 0) {
      try {
        rmSync4(requestPath2(root), { force: true });
      } catch {
      }
      return false;
    }
    writeJsonAtomic(requestPath2(root), { version: 1, requests });
    return true;
  });
}

// src/workspace-reconcile/supervisor.ts
var hashText2 = (value) => createHash5("sha256").update(value).digest("hex");
async function runWorkspaceSupervisor(workspaceRoot, trigger, opts = {}) {
  const entitlement = checkEntitlementCached(process.env);
  if (!entitlement.allowed) return {
    ok: false,
    reason: entitlement.refusal ?? "VisFlow: not licensed",
    members: {},
    candidates: 0,
    linksChanged: 0
  };
  const writeState = (state) => withStateLock(workspaceDir(workspaceRoot), () => writeWorkspaceReconcileState(workspaceRoot, state));
  await enqueueWorkspaceTrigger(workspaceRoot, trigger);
  const guard = acquireStateRunGuard(workspaceDir(workspaceRoot), ".reconcile-running");
  if (!guard.acquired) return {
    ok: true,
    reason: "already-running; trigger coalesced by active workspace",
    alreadyRunning: true,
    members: {},
    candidates: 0,
    linksChanged: 0
  };
  const queued = peekWorkspaceTrigger(workspaceRoot);
  if (queued) trigger = queued.trigger;
  const now = opts.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  const memberResults = {};
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(opts.signal?.reason ?? "cancelled");
  if (opts.signal?.aborted) forwardAbort();
  else opts.signal?.addEventListener("abort", forwardAbort, { once: true });
  const stopWatchingCancellation = watchWorkspaceCancellation(workspaceRoot, guard.token, controller);
  const signal = controller.signal;
  try {
    const loaded = loadWorkspace(workspaceRoot);
    if (!loaded.ok) {
      await writeState({
        version: 1,
        phase: "error",
        members: {},
        pendingCandidates: 0,
        lastRunAt: now(),
        lastReason: loaded.error.messages.join("; ")
      });
      return { ok: false, reason: loaded.error.messages.join("; "), members: {}, candidates: 0, linksChanged: 0 };
    }
    const requested = new Set(
      trigger.kind === "explicit-sync" ? trigger.repositoryIds ?? loaded.workspace.members.map((member) => member.member.repositoryId) : trigger.dirtyRepositoryIds
    );
    const selected = loaded.workspace.members.filter((member) => requested.has(member.member.repositoryId) && member.status === "ready" && member.repoRoot);
    const unavailable = loaded.workspace.members.filter((member) => requested.has(member.member.repositoryId) && (member.status !== "ready" || !member.repoRoot));
    for (const member of unavailable) memberResults[member.member.repositoryId] = {
      ok: false,
      applied: false,
      reason: member.diagnostic ?? `member is ${member.status}`
    };
    await writeState({
      version: 1,
      phase: selected.length ? "members" : "links",
      members: {},
      pendingCandidates: 0,
      lastRunAt: now()
    });
    const linksOnly = trigger.kind === "member-state-change" || trigger.kind === "explicit-sync" && trigger.linksOnly === true;
    const settle = opts.deps?.settle ?? settleRepository;
    const wait = opts.deps?.wait ?? waitForRepositorySettlement;
    const results = await runBounded(selected, opts.concurrency ?? repositoryConcurrency(), async (member) => {
      if (signal.aborted) return { ok: false, applied: false, reason: "cancelled" };
      return linksOnly ? wait(member.repoRoot, { signal }) : settle(member.repoRoot, {
        force: trigger.kind === "explicit-sync",
        llm: opts.llm,
        signal
      });
    });
    selected.forEach((member, index) => {
      memberResults[member.member.repositoryId] = results[index];
    });
    if (signal.aborted) {
      await writeState({
        version: 1,
        phase: "cancelled",
        members: {},
        pendingCandidates: 0,
        lastRunAt: now(),
        lastReason: "workspace reconciliation cancelled"
      });
      return { ok: false, reason: "cancelled", members: memberResults, candidates: 0, linksChanged: 0 };
    }
    const reloaded = loadWorkspace(workspaceRoot);
    if (!reloaded.ok) return { ok: false, reason: reloaded.error.messages.join("; "), members: memberResults, candidates: 0, linksChanged: 0 };
    const failed = new Set(Object.entries(memberResults).filter(([, result]) => !result.ok).map(([id]) => id));
    const eligible = new Set(reloaded.workspace.members.filter((member) => member.status === "ready" && !failed.has(member.member.repositoryId)).map((member) => member.member.repositoryId));
    await writeState({
      version: 1,
      phase: "links",
      members: {},
      pendingCandidates: 0,
      lastRunAt: now()
    });
    const collected = collectWorkspaceBoundaryCandidates(workspaceRoot, {
      refreshBoundary: true,
      eligibleRepositoryIds: eligible
    });
    if (!collected.ok) return { ok: false, reason: collected.reason, members: memberResults, candidates: 0, linksChanged: 0 };
    const expectedMembers = {};
    for (const member of collected.workspace.members) {
      if (!eligible.has(member.member.repositoryId) || member.status !== "ready" || !member.repoRoot || !member.graphRaw) continue;
      const boundary = readBoundaryIndex(member.repoRoot);
      const graphHash = hashText2(member.graphRaw);
      if (boundary.ok && boundary.value.graphHash === graphHash) expectedMembers[member.member.repositoryId] = {
        graphHash,
        boundaryFingerprint: boundary.value.fingerprint
      };
    }
    const live = await reconcileApprovedWorkspaceLinks(
      workspaceRoot,
      collected.joined.candidates,
      collected.workspace.fileRaw,
      expectedMembers
    );
    if (!live.ok && live.reason !== "stale-snapshot") {
      return { ok: false, reason: live.reason, members: memberResults, candidates: 0, linksChanged: 0 };
    }
    if (!live.ok) {
      return { ok: false, reason: "workspace changed during reconciliation; retry required", members: memberResults, candidates: 0, linksChanged: 0 };
    }
    const persisted = await persistWorkspaceCandidates(workspaceRoot, collected.joined.candidates, { now: opts.now });
    if (!persisted.ok) return { ok: false, reason: persisted.reason, members: memberResults, candidates: 0, linksChanged: live.changed };
    const final = loadWorkspace(workspaceRoot);
    const fingerprints = {};
    if (final.ok) {
      for (const member of final.workspace.members) {
        if (member.status !== "ready" || !member.repoRoot || !member.graphRaw) continue;
        const boundary = readBoundaryIndex(member.repoRoot);
        if (!boundary.ok || boundary.value.graphHash !== hashText2(member.graphRaw)) continue;
        fingerprints[member.member.repositoryId] = {
          graphHash: boundary.value.graphHash,
          boundaryFingerprint: boundary.value.fingerprint
        };
      }
    }
    const pending = persisted.store.candidates.filter((candidate) => candidate.status === "pending").length;
    const partial = Object.values(memberResults).some((result) => !result.ok) || collected.diagnostics.length > 0;
    await writeState({
      version: 1,
      phase: partial ? "partial" : pending > 0 ? "review" : "idle",
      members: fingerprints,
      pendingCandidates: pending,
      lastRunAt: now(),
      ...partial ? { lastReason: [
        ...Object.entries(memberResults).filter(([, result]) => !result.ok).map(([id, result]) => `${id}: ${result.reason}`),
        ...collected.diagnostics
      ].join("; ") } : {}
    });
    return {
      ok: true,
      reason: partial ? "completed with unavailable members" : pending ? "review needed" : "up to date",
      members: memberResults,
      candidates: pending,
      linksChanged: live.changed
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      await writeState({
        version: 1,
        phase: "error",
        members: {},
        pendingCandidates: 0,
        lastRunAt: now(),
        lastReason: reason
      });
    } catch {
    }
    return { ok: false, reason, members: memberResults, candidates: 0, linksChanged: 0 };
  } finally {
    stopWatchingCancellation();
    opts.signal?.removeEventListener("abort", forwardAbort);
    clearOwnedWorkspaceCancellation(workspaceRoot, guard.token);
    if (queued) await completeWorkspaceTrigger(workspaceRoot, queued.raw);
    guard.release();
    if (queued && !signal.aborted) {
      const successor = peekWorkspaceTrigger(workspaceRoot);
      if (successor) return await runWorkspaceSupervisor(workspaceRoot, successor.trigger, opts);
    }
  }
}

// src/workspace-reconcile/entry.ts
async function runWorkspaceReconcileEntry(argv) {
  const [workspaceRoot, kind, ids = ""] = argv;
  if (!workspaceRoot || !["session-stop", "member-state-change", "explicit-sync"].includes(kind)) return 1;
  const ent = await checkEntitlement(process.env);
  if (!ent.allowed) {
    console.error(`visflow workspace reconcile: ${ent.refusal ?? "not licensed"}`);
    return 1;
  }
  const repositoryIds = ids.split(",").filter(Boolean);
  const trigger = kind === "explicit-sync" ? { kind, ...repositoryIds.length ? { repositoryIds } : {} } : { kind, dirtyRepositoryIds: repositoryIds };
  const result = await runWorkspaceSupervisor(workspaceRoot, trigger);
  return result.ok ? 0 : 1;
}
if (isMain(import.meta.url)) {
  void runWorkspaceReconcileEntry(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
export {
  runWorkspaceReconcileEntry
};
