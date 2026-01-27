// netlify/functions/brain.mjs
// ============================================================
// PCS UNITED • CENTRAL BRAIN (ESM) — City File Compatibility + Safe Errors
// - ESM only
// - Dynamic imports for Netlify safety
// - GET returns diagnostics
// - POST resolves city JSON even when files are BASE-NAMED
// ============================================================

const SCHEMA_VERSION = "1.2";
const DEPLOY_TAG = "PCS_BRAIN_ESM_DIAG_v1.1_CITYFILE_PATCH_2026-01-27";

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

const __CITY_CACHE__ = new Map(); // cache by fileKey
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

  // Try mortgage.mjs first, then mortgage.js
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
      `mortgage handler not found. Ensure netlify/functions/${__MORTGAGE_MODULE_USED__} exports: export async function handler(event) {}`
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
        `Fix: ensure it's in repo AND netlify.toml [functions].included_files includes netlify/functions/data/**`
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

// -----------------------------
// //#3.1 City file resolution (Orozco-style compatibility)
// -----------------------------
function baseToCityFileKey(baseRaw) {
  const norm = normalizeBaseName(baseRaw);
  if (!norm) return null;

  // Adjust/expand as your PCS city library grows
  const MAP = {
    NELLIS: "Nellis",
    NELLISAFB: "Nellis",

    DAVISMONTHAN: "Davis-Monthan",
    DAVISMONTHANAFB: "Davis-Monthan",

    FORTSAMHOUSTON: "Fort-Sam-Houston",
    JBSALACKLAND: "Lackland",
    LACKLAND: "Lackland",
    RANDOLPH: "Randolph",
    RANDOLPHAFB: "Randolph",

    LUKE: "Luke",
    LUKEAFB: "Luke",

    DYESS: "Dyess",
    DYESSAFB: "Dyess",

    KIRTLAND: "Kirtland",
    KIRTLANDAFB: "Kirtland",

    LAUGHLIN: "Laughlin",
    LAUGHLINAFB: "Laughlin",
  };

  const hit = MAP[norm] || null;
  return hit ? safeKey(hit) : null;
}

function canonicalCityToFileFallback(cityKeyCanonical) {
  const k = safeKey(cityKeyCanonical);
  if (!k) return null;

  // Canonical -> base-named file fallback
  const MAP = {
    LasVegas: "Nellis",
    Tucson: "Davis-Monthan",
    SanAntonio: "Fort-Sam-Houston",
    Phoenix: "Luke",
    Abilene: "Dyess",
    Albuquerque: "Kirtland",
    DelRio: "Laughlin",
  };

  const hit = MAP[k] || null;
  return hit ? safeKey(hit) : null;
}

function resolveCityFileKey({ cityKeyCanonical, profile }) {
  const canonical = safeKey(cityKeyCanonical || "SanAntonio");
  const baseRaw = pickFirst(profile, ["base", "duty_station", "station", "dutyStation", "pcs_base", "pcsBase"]);

  const candidates = [];
  candidates.push(canonical);

  const baseFile = baseToCityFileKey(baseRaw);
  if (baseFile) candidates.push(baseFile);

  const canonicalFallback = canonicalCityToFileFallback(canonical);
  if (canonicalFallback) candidates.push(canonicalFallback);

  // last-resort default
  candidates.push("Fort-Sam-Houston");

  const uniq = [];
  const seen = new Set();
  for (const c of candidates) {
    const cc = safeKey(c);
    if (!cc || seen.has(cc)) continue;
    seen.add(cc);
    uniq.push(cc);
  }

  for (const c of uniq) {
    if (cityFileExists(c)) {
      return {
        ok: true,
        fileKey: c,
        via:
          c === canonical
            ? "direct"
            : c === baseFile
              ? "baseToFileKey"
              : c === canonicalFallback
                ? "canonicalToFileFallback"
                : "lastResort",
        candidates: uniq,
        baseUsed: String(baseRaw || "").trim(),
      };
    }
  }

  return { ok: false, fileKey: null, via: "none", candidates: uniq, baseUsed: String(baseRaw || "").trim() };
}

function loadCity(cityKeyCanonical, profileForFilePick) {
  const canonical = safeKey(cityKeyCanonical || "SanAntonio");
  const idx = listCityFiles();

  const res = resolveCityFileKey({ cityKeyCanonical: canonical, profile: profileForFilePick || {} });
  if (!res.ok || !res.fileKey) {
    throw new Error(
      `City JSON not found. requested="${canonical}" availableFiles=${Array.from(idx).sort().join(", ")}`
    );
  }

  const fileKey = res.fileKey;

  if (__CITY_CACHE__.has(fileKey)) {
    const cached = __CITY_CACHE__.get(fileKey);
    return {
      ...cached,
      canonical_city_key: canonical,
      cityFileRequested: canonical,
      cityFileUsed: fileKey,
      cityFileVia: res.via,
      cityFileCandidates: res.candidates,
      baseUsedForCityFile: res.baseUsed || null,
    };
  }

  const filePath = __path.join(__CITIES_DIR, `${fileKey}.json`);
  const raw = __fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  const out = {
    key: fileKey,
    canonical_city_key: canonical,
    ...data,
    cityFileRequested: canonical,
    cityFileUsed: fileKey,
    cityFileVia: res.via,
    cityFileCandidates: res.candidates,
    baseUsedForCityFile: res.baseUsed || null,
  };

  __CITY_CACHE__.set(fileKey, out);
  return out;
}

// -----------------------------
// //#4 Supabase
// -----------------------------
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars.");
  }

  return __createClient(url, key, { auth: { persistSession: false } });
}

async function fetchProfileByEmail(email) {
  const sb = getSupabase();
  const { data, error } = await sb.from("profiles").select("*").eq("email", email).maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message || "Supabase profile fetch failed.", data: null };
  if (!data) return { ok: false, status: 404, error: "Profile not found for this email.", data: null };
  return { ok: true, status: 200, error: null, data };
}

// -----------------------------
// //#5 Mortgage passthrough (optional validation)
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
// //#6 Diagnostics (GET)
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
    cityJsonNamesPreview: null,
  };

  for (const p of __PAY_TABLES_PATHS || []) {
    if (__fs.existsSync(p)) {
      files.payTablesFound = p;
      break;
    }
  }

  if (files.citiesDirExists) {
    try {
      const names = __fs.readdirSync(__CITIES_DIR).filter((f) => /\.json$/i.test(f)).map((f) => f.replace(/\.json$/i, ""));
      files.cityJsonCount = names.length;
      files.cityJsonNamesPreview = names.slice(0, 20);
    } catch (_) {
      files.cityJsonCount = 0;
      files.cityJsonNamesPreview = [];
    }
  }

  const modules = {
    mortgageModuleUsed: __MORTGAGE_MODULE_USED__ || null,
    hasMortgageHandler: typeof __mortgageHandler === "function",
  };

  return { env, files, modules };
}

// -----------------------------
// //#7 Handler
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
      return respond(event, 405, { ok: false, schemaVersion: SCHEMA_VERSION, deployTag: DEPLOY_TAG, error: "Method not allowed." });
    }

    const body = JSON.parse(event.body || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const cityKey = safeKey(body.cityKey || "SanAntonio");
    const bedrooms = toInt(body.bedrooms) ?? 4;

    if (!email) {
      return respond(event, 400, { ok: false, schemaVersion: SCHEMA_VERSION, deployTag: DEPLOY_TAG, error: "Missing email." });
    }

    const payTables = loadPayTables();

    const prof = await fetchProfileByEmail(email);
    if (!prof.ok) {
      return respond(event, prof.status, {
        ok: false,
        schemaVersion: SCHEMA_VERSION,
        deployTag: DEPLOY_TAG,
        error: prof.error,
        hint:
          prof.status === 404
            ? "This email is not in PCS Supabase public.profiles. Insert the row or test with an existing email."
            : "Supabase error. Check Netlify logs for details.",
      });
    }

    const profile = prof.data;

    // City: canonical key, but loads base-named file if needed
    const city = loadCity(cityKey, profile);

    // Optional mortgage ping to prove module graph works
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
        cityFileRequested: city?.cityFileRequested || null,
        cityFileUsed: city?.cityFileUsed || null,
        cityFileVia: city?.cityFileVia || null,
      },
      profile,
      city,
    });
  } catch (e) {
    return respond(event, 500, {
      ok: false,
      schemaVersion: SCHEMA_VERSION,
      deployTag: DEPLOY_TAG,
      error: String(e?.message || e),
    });
  }
}
