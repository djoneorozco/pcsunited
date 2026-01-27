/* ============================================================
  PCSUnited • CENTRAL BRAIN (v1.0.4) — PAY + CITY (NO MORTGAGE)
  ✅ ESM SAFE (package.json: "type":"module")
  ✅ Netlify-safe paths via import.meta.url + fallbacks
  ✅ CORS + OPTIONS
  ✅ Deterministic Active Duty pay: BasePay + BAS + BAH
  ✅ City JSON loads from netlify/functions/cities/*
  ✅ Pay tables load from netlify/functions/data/militaryPayTables.json

  POST JSON:
    { "email": "you@email.com", "bedrooms": 4 }

============================================================ */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// //#0 Version tags
// ============================================================
const SCHEMA_VERSION = "1.2";
const DEPLOY_TAG = "PCS_BRAIN_v1.0.4_ESM_2026-01-27";

// ============================================================
// //#1 Paths (ESM-safe)
// ============================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In Netlify, the bundled function typically lives in:
//   /var/task/netlify/functions/brain.js
// So these relative paths usually work:
const ROOT = process.cwd(); // /var/task
const FUNCTIONS_DIR = __dirname;

// Prefer relative-to-function paths first, then fallback to cwd-based paths.
const PAY_TABLE_CANDIDATES = [
  path.join(FUNCTIONS_DIR, "data", "militaryPayTables.json"),
  path.join(ROOT, "netlify", "functions", "data", "militaryPayTables.json"),
  path.join(ROOT, "netlify", "functions", "militaryPayTables.json"),
];

const CITIES_DIR_CANDIDATES = [
  path.join(FUNCTIONS_DIR, "cities"),
  path.join(ROOT, "netlify", "functions", "cities"),
];

const BASES_INDEX_CANDIDATES = [
  // If you later add bases.json, we’ll pick it up automatically
  "bases.json",
  "index.byBase.json",
  "indexByBase.json",
];

// Resolve cities dir
function resolveCitiesDir() {
  for (const p of CITIES_DIR_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  // fallback anyway (keeps error messages consistent)
  return CITIES_DIR_CANDIDATES[0];
}
const CITIES_DIR = resolveCitiesDir();

// ============================================================
// //#2 CORS helpers
// ============================================================
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}

function respond(statusCode, obj) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(obj),
  };
}

// ============================================================
// //#3 Small helpers
// ============================================================
function safeKey(s) {
  return String(s || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
}
function toInt(x) {
  const n = Number.parseInt(String(x ?? "").trim(), 10);
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

// ============================================================
// //#4 JSON loading (bundled files)
// ============================================================
let PAY_TABLES_CACHE = null;
let PAY_TABLES_PATH_USED = null;

let BASES_INDEX_CACHE = null;
let BASES_INDEX_PATH_USED = null;

const CITY_CACHE = new Map(); // fileKey -> json
let CITY_FILE_INDEX = null;

function loadJsonFromFirstExisting(paths, labelForError) {
  let found = null;
  for (const p of paths || []) {
    if (existsSync(p)) {
      found = p;
      break;
    }
  }
  if (!found) {
    throw new Error(
      `${labelForError} not found. Tried:\n- ${(paths || []).join("\n- ")}\n` +
        `Fix: ensure it's bundled via netlify.toml [functions].included_files`
    );
  }
  const raw = readFileSync(found, "utf8");
  return { pathUsed: found, data: JSON.parse(raw) };
}

function loadPayTables() {
  if (PAY_TABLES_CACHE) return PAY_TABLES_CACHE;
  const { pathUsed, data } = loadJsonFromFirstExisting(PAY_TABLE_CANDIDATES, "militaryPayTables.json");
  PAY_TABLES_CACHE = data;
  PAY_TABLES_PATH_USED = pathUsed;
  return PAY_TABLES_CACHE;
}

function loadBasesIndex() {
  if (BASES_INDEX_CACHE) return BASES_INDEX_CACHE;

  // Try each candidate filename inside the resolved cities dir
  const candidates = BASES_INDEX_CANDIDATES.map((f) => path.join(CITIES_DIR, f));
  for (const p of candidates) {
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf8");
      BASES_INDEX_CACHE = JSON.parse(raw);
      BASES_INDEX_PATH_USED = p;
      return BASES_INDEX_CACHE;
    }
  }

  BASES_INDEX_CACHE = null;
  BASES_INDEX_PATH_USED = null;
  return null;
}

function listCityFiles() {
  if (CITY_FILE_INDEX) return CITY_FILE_INDEX;

  try {
    const files = readdirSync(CITIES_DIR)
      .filter((f) => /\.json$/i.test(f))
      .map((f) => f.replace(/\.json$/i, ""))
      .filter((name) => {
        const n = String(name || "").toLowerCase();
        return n !== "bases" && n !== "index.bybase" && n !== "indexbybase";
      });

    CITY_FILE_INDEX = new Set(files);
    return CITY_FILE_INDEX;
  } catch {
    CITY_FILE_INDEX = new Set();
    return CITY_FILE_INDEX;
  }
}

function cityFileExists(fileKey) {
  const k = safeKey(fileKey);
  if (!k) return false;
  return listCityFiles().has(k);
}

// bases index can be array or object map — same logic as your CJS version
function resolveFromBasesIndex(baseRaw) {
  const idx = loadBasesIndex();
  if (!idx || typeof idx !== "object") return null;

  const norm = normalizeBaseName(baseRaw);
  if (!norm) return null;

  // Array shape
  if (Array.isArray(idx)) {
    const hit = idx.find((r) => normalizeBaseName(r?.base || r?.name || r?.installation) === norm);
    if (!hit) return null;
    return {
      cityKey: safeKey(hit.cityKey || hit.city_key || hit.city || ""),
      fileKey: safeKey(hit.file || hit.fileKey || hit.cityFile || hit.city_file || ""),
      zip: String(hit.zip || hit.postal_code || "").trim() || null,
      source: "basesIndex[array]",
    };
  }

  // Object map shape
  let map = idx;
  if (idx.bases && typeof idx.bases === "object") map = idx.bases;

  const hit = map[norm] || map[String(baseRaw || "").trim()] || null;
  if (!hit) return null;

  return {
    cityKey: safeKey(hit.cityKey || hit.city_key || hit.city || ""),
    fileKey: safeKey(hit.file || hit.fileKey || hit.cityFile || hit.city_file || ""),
    zip: String(hit.zip || hit.postal_code || "").trim() || null,
    source: "basesIndex[object]",
  };
}

function loadCityByFileKey(fileKey, canonicalCityKey) {
  const fk = safeKey(fileKey);
  if (!fk) throw new Error("Missing city fileKey.");

  if (CITY_CACHE.has(fk)) {
    const cached = CITY_CACHE.get(fk);
    return {
      ...cached,
      canonical_city_key: safeKey(canonicalCityKey || cached?.canonical_city_key || ""),
      cityFileUsed: fk,
    };
  }

  const filePath = path.join(CITIES_DIR, `${fk}.json`);
  if (!existsSync(filePath)) throw new Error(`City JSON not found at ${filePath}`);

  const raw = readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  const out = {
    ...data,
    raw: data,
    canonical_city_key: safeKey(canonicalCityKey || ""),
    cityFileUsed: fk,
  };

  CITY_CACHE.set(fk, out);
  return out;
}

function deriveCityAndFile(profile) {
  const baseRaw = pickFirst(profile, ["pcs_base", "pcsBase", "base", "duty_station", "station", "dutyStation"]);
  const baseName = String(baseRaw || "").trim();

  const fromBases = resolveFromBasesIndex(baseName);
  if (fromBases?.fileKey && cityFileExists(fromBases.fileKey)) {
    return {
      ok: true,
      base: baseName,
      cityKey: fromBases.cityKey || null,
      fileKey: fromBases.fileKey,
      zip: fromBases.zip || null,
      source: fromBases.source,
    };
  }

  // Known-good fallback if present
  if (cityFileExists("Fort-Sam-Houston")) {
    return {
      ok: true,
      base: baseName,
      cityKey: "SanAntonio",
      fileKey: "Fort-Sam-Houston",
      zip: null,
      source: "fallback:Fort-Sam-Houston",
    };
  }

  // Final fallback: first city file
  const any = Array.from(listCityFiles())[0] || null;
  if (any) {
    return {
      ok: true,
      base: baseName,
      cityKey: safeKey(any),
      fileKey: safeKey(any),
      zip: null,
      source: "fallback:firstCityFile",
    };
  }

  return { ok: false, base: baseName, cityKey: null, fileKey: null, zip: null, source: "none" };
}

// ============================================================
// //#5 Deterministic pay math
// ============================================================
function computeBasePay(rank, yos, payTables, missing) {
  let basePay = 0;
  if (rank && yos !== null) {
    const baseTable = payTables?.BASEPAY?.[rank];
    if (!baseTable) missing.push("basepay_table_for_rank");
    else {
      const picked = pickNearestYos(baseTable, yos);
      if (picked == null) missing.push("basepay_value");
      else basePay = Number(picked) || 0;
    }
  }
  return basePay;
}

function computeBAS(rank, payTables) {
  const isOfficer = /^O-/.test(rank);
  const basObj = payTables?.BAS || {};
  return Number(isOfficer ? basObj.officer : basObj.enlisted) || 0;
}

function computeBAH(rank, familyBool, zip, payTables, missing) {
  if (!zip) {
    missing.push("bah_zip_missing");
    return 0;
  }
  if (!rank) {
    missing.push("bah_rank_missing");
    return 0;
  }

  const bahZip =
    payTables?.BAH_TX?.[zip] ||
    payTables?.BAH?.by_zip?.[zip] ||
    payTables?.BAH?.byZip?.[zip] ||
    payTables?.BAH?.[zip] ||
    null;

  if (!bahZip) {
    missing.push("bah_zip_not_found");
    return 0;
  }

  const bucket = familyBool ? bahZip.with : bahZip.without;
  if (!bucket) {
    missing.push("bah_bucket_missing");
    return 0;
  }

  const val = bucket?.[rank];
  if (val == null) {
    missing.push("bah_rank_not_found");
    return 0;
  }

  return Number(val) || 0;
}

function detectPayModel(profile) {
  const modeRaw = lower(profile?.mode);
  if (modeRaw) {
    if (["vet", "veteran", "retired", "retiree", "sep", "separated", "civ", "civilian"].includes(modeRaw)) return "veteran";
    if (["ad", "active", "active_duty", "activeduty"].includes(modeRaw)) return "active";
  }
  return "active";
}

function computePay(profile, payTables, cityPick, city) {
  const missing = [];
  const payModel = detectPayModel(profile);

  const rank = normalizeRank(profile?.rank_paygrade || profile?.rank || "");
  const yos = toInt(profile?.yos ?? profile?.years_of_service ?? profile?.yearsOfService);

  const famRaw = profile?.family ?? profile?.dependents ?? profile?.has_dependents ?? profile?.family_size ?? profile?.familySize;
  const famInt = toInt(famRaw);
  const familyBool =
    String(famRaw).toLowerCase() === "true" ||
    famRaw === true ||
    (Number.isFinite(famInt) ? famInt >= 2 : false);

  if (!rank) missing.push("rank_paygrade");
  if (yos === null) missing.push("yos");

  const basePay = computeBasePay(rank, yos, payTables, missing);

  if (payModel === "veteran") {
    return {
      ok: basePay > 0,
      missing: ["veteran_mode_not_enabled_in_pcs_brain"].concat(missing),
      pay: {
        ok: basePay > 0,
        payModel,
        payAccuracy: "partial",
        basePay,
        bas: 0,
        bah: 0,
        totalPay: basePay,
        total: basePay,
        zipUsed: null,
        familyUsed: familyBool,
        rankUsed: rank || null,
        yosUsed: yos,
      },
    };
  }

  // ZIP resolution:
  // 1) profile.zip
  // 2) bases index zip
  // 3) city.zip
  // 4) payTables.BAH.base_to_zip by profile/base label (if present)
  const zipFromProfile = String(profile?.zip || profile?.postal_code || "").trim();
  const zipFromPick = String(cityPick?.zip || "").trim();
  const zipFromCity = String(city?.zip || city?.postal_code || "").trim();

  let zip = zipFromProfile || zipFromPick || zipFromCity || "";

  if (!zip) {
    const baseRaw = pickFirst(profile, ["pcs_base", "pcsBase", "base", "duty_station", "station", "dutyStation"]);
    const baseLabel = String(baseRaw || "").trim();
    const baseToZip = payTables?.BAH?.base_to_zip || {};
    if (baseLabel && baseToZip[baseLabel]) zip = String(baseToZip[baseLabel]).trim();
  }

  const bas = computeBAS(rank, payTables);
  const bah = computeBAH(rank, familyBool, zip || null, payTables, missing);
  const totalPay = basePay + bas + bah;

  return {
    ok: totalPay > 0,
    missing,
    pay: {
      ok: totalPay > 0,
      payModel,
      payAccuracy: "deterministic",
      basePay,
      bas,
      bah,
      totalPay,
      total: totalPay,
      zipUsed: zip || null,
      familyUsed: familyBool,
      rankUsed: rank || null,
      yosUsed: yos,
    },
  };
}

// ============================================================
// //#6 Supabase profile lookup
// ============================================================
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchProfileByEmail(email) {
  const sb = getSupabase();
  const { data, error } = await sb.from("profiles").select("*").eq("email", email).maybeSingle();
  if (error) throw new Error(error.message || "Supabase profile fetch failed.");
  if (!data) throw new Error("Profile not found for this email.");
  return data;
}

// ============================================================
// //#7 Netlify handler (ESM)
// ============================================================
export const handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }

    if (event.httpMethod === "GET") {
      return respond(200, {
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        deployTag: DEPLOY_TAG,
        runtime: {
          node: process.version,
          cwd: process.cwd(),
          functionsDir: FUNCTIONS_DIR,
          citiesDir: CITIES_DIR,
        },
        note: "POST JSON: { email, bedrooms? }",
      });
    }

    if (event.httpMethod !== "POST") {
      return respond(405, { ok: false, schemaVersion: SCHEMA_VERSION, deployTag: DEPLOY_TAG, error: "Method not allowed." });
    }

    const body = JSON.parse(event.body || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const bedrooms = toInt(body.bedrooms) ?? 4;

    if (!email) {
      return respond(400, { ok: false, schemaVersion: SCHEMA_VERSION, deployTag: DEPLOY_TAG, error: "Missing email." });
    }

    const payTables = loadPayTables();
    const profile = await fetchProfileByEmail(email);

    const cityPick = deriveCityAndFile(profile);

    let city = null;
    let cityError = null;

    try {
      if (cityPick.ok && cityPick.fileKey) {
        city = loadCityByFileKey(cityPick.fileKey, cityPick.cityKey || null);
      } else {
        city = cityFileExists("Fort-Sam-Houston") ? loadCityByFileKey("Fort-Sam-Houston", "SanAntonio") : null;
      }
    } catch (e) {
      cityError = String(e?.message || e);
      city = null;
    }

    const computed = computePay(profile, payTables, cityPick, city);

    return respond(200, {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      deployTag: DEPLOY_TAG,
      input: { email, bedrooms },

      debug: {
        payTablesPathUsed: PAY_TABLES_PATH_USED || null,
        basesIndexPathUsed: BASES_INDEX_PATH_USED || null,
        cityPick,
        cityLoadError: cityError || null,
        cityFileUsed: city?.cityFileUsed || null,
      },

      profile,
      pay: computed.pay,
      city,
      missing: computed.missing || [],

      mortgage: null,
      estimatedMonthlyMortgage: 0,
    });
  } catch (e) {
    return respond(500, {
      ok: false,
      schemaVersion: SCHEMA_VERSION,
      deployTag: DEPLOY_TAG,
      error: String(e?.message || e),
    });
  }
};
