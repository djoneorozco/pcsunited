// netlify/functions/brain.mjs
// ============================================================
// PCS UNITED • CENTRAL BRAIN (ESM) — Diagnostic-safe
// - ESM-first (no module.exports, no require)
// - Dynamic imports for Netlify safety
// - GET returns diagnostics (env/files/module graph) to end guessing
// ============================================================

const SCHEMA_VERSION = "1.2";
const DEPLOY_TAG = "PCS_BRAIN_ESM_DIAG_v1.0_2026-01-27";

// -----------------------------
// //#0 Runtime deps (ESM safe)
// -----------------------------
let __fs = null;
let __path = null;
let __createClient = null;
let __mortgageHandler = null;

let __ROOT = null;
let __PAY_TABLES_PATHS = null;
let __CITIES_DIR = null;

let __PAY_TABLES_CACHE__ = null;
let __PAY_TABLES_PATH_USED__ = null;

const __CITY_CACHE__ = new Map();
let __CITY_FILE_INDEX__ = null;

let __MORTGAGE_MODULE_USED__ = null;

async function ensureDeps() {
  if (__fs && __path && __createClient && __mortgageHandler) return;

  const fsMod = await import("node:fs");
  const pathMod = await import("node:path");
  __fs = fsMod.default || fsMod;
  __path = pathMod.default || pathMod;

  const sbMod = await import("@supabase/supabase-js");
  __createClient = sbMod.createClient;

  // Try mortgage.mjs first, then mortgage.js (so ESM projects can move cleanly)
  let mortMod = null;
  try {
    mortMod = await import("./mortgage.mjs");
    __MORTGAGE_MODULE_USED__ = "mortgage.mjs";
  } catch (_) {
    mortMod = await import("./mortgage.js");
    __MORTGAGE_MODULE_USED__ = "mortgage.js";
  }

  __mortgageHandler = mortMod?.handler;

  if (typeof __mortgageHandler !== "function") {
    throw new Error(
      `mortgage handler not found. Ensure netlify/functions/${__MORTGAGE_MODULE_USED__} exports: export async function handler(event) { ... }`
    );
  }

  __ROOT = process.cwd(); // /var/task
  __PAY_TABLES_PATHS = [
    __path.join(__ROOT, "netlify", "functions", "militaryPayTables.json"),
    __path.join(__ROOT, "netlify", "functions", "data", "militaryPayTables.json"),
  ];
  __CITIES_DIR = __path.join(__ROOT, "netlify", "functions", "cities");
}

// -----------------------------
// //#1 CORS (robust)
// -----------------------------
function buildCorsHeaders(event) {
  const origin = event?.headers?.origin || event?.headers?.Origin || "*";
  const reqHeaders =
    event?.headers?.["access-control-request-headers"] ||
    event?.headers?.["Access-Control-Request-Headers"] ||
    "Content-Type, Authorization";

  return {
    "Access-Control-Allow-Origin": origin === "null" ? "*" : origin,
    "Access-Control-Allow-Headers": reqHeaders,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}

function respond(event, statusCode, obj) {
  return { statusCode, headers: buildCorsHeaders(event), body: JSON.stringify(obj) };
}

// -----------------------------
// //#2 Helpers
// -----------------------------
function safeKey(s) {
  return String(s || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
}
function toInt(x) {
  const n = Number.parseInt(String(x ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}
function toNum(x) {
  const n = Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : null;
}
function lower(x) {
  return String(x ?? "").trim().toLowerCase();
}
function normalizeRank(rank) {
  const r = String(rank || "").trim().toUpperCase();
  const m = r.match(/^([EO]|W)\s*-?\s*(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2]}`;
  return r;
}
function normalizeBaseName(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}
function pickFirst(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}
function pickNearestYos(tableForRank, yos) {
  const keys = Object.keys(tableForRank || {})
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (!keys.length) return null;

  let chosen = keys[0];
  for (const k of keys) {
    if (k <= yos) chosen = k;
  }
  return tableForRank[String(chosen)] ?? null;
}

// -----------------------------
// //#3 File loading
// -----------------------------
function loadPayTables() {
  if (__PAY_TABLES_CACHE__) return __PAY_TABLES_CACHE__;

  let found = null;
  for (const p of __PAY_TABLES_PATHS || []) {
    if (__fs.existsSync(p)) {
      found = p;
      break;
    }
  }

  if (!found) {
    throw new Error(
      `militaryPayTables.json not found. Tried:\n- ${( __PAY_TABLES_PATHS || []).join("\n- ")}\n` +
      `Fix: ensure file exists in repo AND netlify.toml [functions].included_files includes netlify/functions/data/**`
    );
  }

  const raw = __fs.readFileSync(found, "utf8");
  __PAY_TABLES_CACHE__ = JSON.parse(raw);
  __PAY_TABLES_PATH_USED__ = found;
  return __PAY_TABLES_CACHE__;
}

function listCityFiles() {
  if (__CITY_FILE_INDEX__) return __CITY_FILE_INDEX__;
  try {
    const files = __fs
      .readdirSync(__CITIES_DIR)
      .filter((f) => /\.json$/i.test(f))
      .map((f) => f.replace(/\.json$/i, ""));
    __CITY_FILE_INDEX__ = new Set(files);
    return __CITY_FILE_INDEX__;
  } catch (_) {
    __CITY_FILE_INDEX__ = new Set();
    return __CITY_FILE_INDEX__;
  }
}

function cityFileExists(fileKey) {
  const k = safeKey(fileKey);
  if (!k) return false;
  const idx = listCityFiles();
  return idx.has(k);
}

function loadCity(cityKeyCanonical) {
  const canonical = safeKey(cityKeyCanonical || "SanAntonio");
  const idx = listCityFiles();

  // PCSUnited: simplest version — expects canonical filename exists
  // (If you want the base->fileKey compatibility patch like OrozcoRealty, we can add it next.)
  if (!cityFileExists(canonical)) {
    throw new Error(
      `City JSON not found for "${canonical}". Available: ${Array.from(idx).sort().join(", ")}`
    );
  }

  if (__CITY_CACHE__.has(canonical)) return __CITY_CACHE__.get(canonical);

  const filePath = __path.join(__CITIES_DIR, `${canonical}.json`);
  const raw = __fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  const out = { key: canonical, ...data };
  __CITY_CACHE__.set(canonical, out);
  return out;
}

// -----------------------------
// //#4 Supabase
// -----------------------------
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    // IMPORTANT: This is the #1 reason PCS will POST-500 while Orozco works.
    throw new Error(
      `Missing Supabase env vars. Need SUPABASE_URL and SUPABASE_SERVICE_KEY on THIS Netlify site.`
    );
  }

  return __createClient(url, key, { auth: { persistSession: false } });
}

async function fetchProfileByEmail(email) {
  const sb = getSupabase();
  const { data, error } = await sb.from("profiles").select("*").eq("email", email).maybeSingle();
  if (error) throw new Error(error.message || "Supabase profile fetch failed.");
  if (!data) throw new Error("Profile not found for this email.");
  return data;
}

// -----------------------------
// //#5 Pay math (minimal)
// -----------------------------
function computePay(profile, payTables) {
  const missing = [];

  const rank = normalizeRank(profile?.rank_paygrade || profile?.rank || "");
  const yos = toInt(profile?.yos ?? profile?.years_of_service ?? profile?.yearsOfService);

  if (!rank) missing.push("rank_paygrade");
  if (yos === null) missing.push("yos");

  let basePay = 0;
  const baseTable = payTables?.BASEPAY?.[rank];
  if (!baseTable) missing.push("basepay_table_for_rank");
  else {
    const picked = pickNearestYos(baseTable, yos ?? 0);
    if (picked == null) missing.push("basepay_value");
    else basePay = Number(picked) || 0;
  }

  return {
    missing,
    pay: {
      ok: basePay > 0,
      rankUsed: rank || null,
      yosUsed: yos,
      basePay,
      total: basePay,
    },
  };
}

// -----------------------------
// //#6 Mortgage passthrough
// -----------------------------
async function callMortgageEngine(payload) {
  const evt = { httpMethod: "POST", headers: {}, body: JSON.stringify(payload || {}) };
  const res = await __mortgageHandler(evt);
  let out = null;
  try {
    out = res?.body ? JSON.parse(res.body) : null;
  } catch (_) {
    out = null;
  }
  return { res, out };
}

// -----------------------------
// //#7 Diagnostics (GET)
// -----------------------------
function diagnostics() {
  const env = {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
    NODE_VERSION: process.version,
    CWD: process.cwd(),
  };

  const files = {
    payTablesTried: __PAY_TABLES_PATHS || [],
    payTablesFound: null,
    citiesDir: __CITIES_DIR || null,
    citiesDirExists: __CITIES_DIR ? __fs.existsSync(__CITIES_DIR) : false,
    cityJsonCount: null,
  };

  for (const p of __PAY_TABLES_PATHS || []) {
    if (__fs.existsSync(p)) {
      files.payTablesFound = p;
      break;
    }
  }

  if (files.citiesDirExists) {
    try {
      files.cityJsonCount = __fs.readdirSync(__CITIES_DIR).filter((f) => /\.json$/i.test(f)).length;
    } catch (_) {
      files.cityJsonCount = 0;
    }
  }

  const modules = {
    mortgageModuleUsed: __MORTGAGE_MODULE_USED__ || null,
    hasMortgageHandler: typeof __mortgageHandler === "function",
  };

  return { env, files, modules };
}

// -----------------------------
// //#8 Handler
// -----------------------------
export async function handler(event) {
  try {
    await ensureDeps();

    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: buildCorsHeaders(event), body: "" };
    }

    if (event.httpMethod === "GET") {
      return respond(event, 200, {
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        deployTag: DEPLOY_TAG,
        note: "POST JSON: { email, cityKey?, bedrooms? }",
        diagnostics: diagnostics(),
      });
    }

    if (event.httpMethod !== "POST") {
      return respond(event, 405, { ok: false, schemaVersion: SCHEMA_VERSION, error: "Method not allowed." });
    }

    const body = JSON.parse(event.body || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const cityKey = safeKey(body.cityKey || "SanAntonio");
    const bedrooms = toInt(body.bedrooms) ?? 4;

    if (!email) return respond(event, 400, { ok: false, schemaVersion: SCHEMA_VERSION, error: "Missing email." });

    const payTables = loadPayTables();
    const profile = await fetchProfileByEmail(email);
    const computed = computePay(profile, payTables);
    const city = loadCity(cityKey);

    // Mortgage call just to validate module graph (optional)
    const mort = await callMortgageEngine({ price: 400000, down: 5, termYears: 30 });

    return respond(event, 200, {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      deployTag: DEPLOY_TAG,
      input: { email, cityKey, bedrooms },
      debug: {
        payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null,
        mortgageModuleUsed: __MORTGAGE_MODULE_USED__ || null,
        mortgageOk: mort?.out?.ok === true,
      },
      profile,
      pay: computed.pay,
      missing: computed.missing,
      city,
    });
  } catch (e) {
    // NOTE: This ensures even failures return CORS headers (prevents “fake CORS” errors).
    return respond(event, 500, {
      ok: false,
      schemaVersion: SCHEMA_VERSION,
      deployTag: DEPLOY_TAG,
      error: String(e?.message || e),
    });
  }
}
