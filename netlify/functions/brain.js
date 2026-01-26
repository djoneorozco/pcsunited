// netlify/functions/brain.js
// ============================================================
// PCSUnited • CENTRAL BRAIN (v1.0.0) — Pay + City + (Optional) Mortgage
//
// ✅ PRIMARY GOAL:
// - ALWAYS return deterministic PAY (Base Pay + BAS + BAH) + City baselines
// - Never allow mortgage.js (or any other module) to crash the endpoint
//
// ✅ DATA PATHS (PCSUnited):
// - Pay Tables: netlify/functions/data/militaryPayTables.json
// - Bases Index: netlify/functions/cities/bases.json
// - City JSONs:  netlify/functions/cities/*.json   (e.g., Davis-Monthan.json)
//
// ✅ CORS:
// - OPTIONS returns 204 with headers (preflight success)
// ============================================================

const SCHEMA_VERSION = "1.2";

// -----------------------------
// //#0 Runtime deps (ESM-safe dynamic imports)
// -----------------------------
let __fs = null;
let __path = null;
let __createClient = null;

// mortgage.js is OPTIONAL — if it fails, we keep going
let __mortgageHandler = null;
let __mortgageImportError = null;

let __ROOT = null;
let __PAY_TABLES_PATHS = null;
let __CITIES_DIR = null;
let __BASES_INDEX_PATHS = null;

async function ensureDeps() {
  if (__fs && __path && __createClient) return;

  const fsMod = await import("node:fs");
  const pathMod = await import("node:path");
  __fs = fsMod.default || fsMod;
  __path = pathMod.default || pathMod;

  const sbMod = await import("@supabase/supabase-js");
  __createClient = sbMod.createClient;

  __ROOT = process.cwd(); // /var/task on Netlify
  __PAY_TABLES_PATHS = [
    __path.join(__ROOT, "netlify", "functions", "data", "militaryPayTables.json"),
    __path.join(__ROOT, "netlify", "functions", "militaryPayTables.json"),
  ];
  __CITIES_DIR = __path.join(__ROOT, "netlify", "functions", "cities");
  __BASES_INDEX_PATHS = [
    __path.join(__ROOT, "netlify", "functions", "cities", "bases.json"),
    __path.join(__ROOT, "netlify", "functions", "cities", "index.byBase.json"),
    __path.join(__ROOT, "netlify", "functions", "cities", "indexByBase.json"),
  ];

  // Try to import mortgage.js, but DO NOT crash if it fails (ESM/CJS mismatch, etc.)
  try {
    const mortMod = await import("./mortgage.js");
    const h = mortMod?.handler;
    if (typeof h === "function") {
      __mortgageHandler = h;
      __mortgageImportError = null;
    } else {
      __mortgageHandler = null;
      __mortgageImportError = "mortgage.js found but does not export `handler`.";
    }
  } catch (e) {
    __mortgageHandler = null;
    __mortgageImportError = String(e?.message || e);
  }
}

// -----------------------------
// //#1 CORS
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
// //#2 Small helpers
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
// //#3 File loading (Netlify-safe)
// -----------------------------
let __PAY_TABLES_CACHE__ = null;
let __PAY_TABLES_PATH_USED__ = null;

let __BASES_INDEX_CACHE__ = null;
let __BASES_INDEX_PATH_USED__ = null;

const __CITY_CACHE__ = new Map(); // key = fileKey (filename without .json)
let __CITY_FILE_INDEX__ = null;

function loadJsonFromFirstExisting(paths, labelForError) {
  let found = null;
  for (const p of paths || []) {
    if (__fs.existsSync(p)) { found = p; break; }
  }
  if (!found) {
    throw new Error(
      `${labelForError} not found. Tried:\n- ${(paths || []).join("\n- ")}\n` +
      `Fix: ensure it's bundled via netlify.toml [functions].included_files.`
    );
  }
  const raw = __fs.readFileSync(found, "utf8");
  return { pathUsed: found, data: JSON.parse(raw) };
}

function loadPayTables() {
  if (__PAY_TABLES_CACHE__) return __PAY_TABLES_CACHE__;
  const { pathUsed, data } = loadJsonFromFirstExisting(__PAY_TABLES_PATHS, "militaryPayTables.json");
  __PAY_TABLES_CACHE__ = data;
  __PAY_TABLES_PATH_USED__ = pathUsed;
  return __PAY_TABLES_CACHE__;
}

function loadBasesIndex() {
  if (__BASES_INDEX_CACHE__) return __BASES_INDEX_CACHE__;
  try {
    const { pathUsed, data } = loadJsonFromFirstExisting(__BASES_INDEX_PATHS, "bases.json");
    __BASES_INDEX_CACHE__ = data;
    __BASES_INDEX_PATH_USED__ = pathUsed;
    return __BASES_INDEX_CACHE__;
  } catch (e) {
    __BASES_INDEX_CACHE__ = null;
    __BASES_INDEX_PATH_USED__ = null;
    return null;
  }
}

function listCityFiles() {
  if (__CITY_FILE_INDEX__) return __CITY_FILE_INDEX__;
  try {
    const files = __fs.readdirSync(__CITIES_DIR)
      .filter((f) => /\.json$/i.test(f))
      .map((f) => f.replace(/\.json$/i, ""));
    __CITY_FILE_INDEX__ = new Set(files);
    return __CITY_FILE_INDEX__;
  } catch (e) {
    __CITY_FILE_INDEX__ = new Set();
    return __CITY_FILE_INDEX__;
  }
}

function cityFileExists(fileKey) {
  const k = safeKey(fileKey);
  if (!k) return false;
  return listCityFiles().has(k);
}

function resolveFromBasesIndex(baseRaw) {
  const idx = loadBasesIndex();
  if (!idx || typeof idx !== "object") return null;

  const norm = normalizeBaseName(baseRaw);
  if (!norm) return null;

  // Support multiple shapes:
  // A) { "NELLIS": { cityKey:"LasVegas", file:"Nellis", zip:"89191" }, ... }
  // B) { "bases": { ... } }
  // C) [ { base:"Nellis", cityKey:"LasVegas", file:"Nellis", zip:"..." }, ... ]
  let map = idx;

  if (Array.isArray(idx)) {
    const hit = idx.find((r) => normalizeBaseName(r?.base || r?.name || r?.installation) === norm);
    if (!hit) return null;
    return {
      cityKey: safeKey(hit.cityKey || hit.city_key || hit.city || ""),
      fileKey: safeKey(hit.file || hit.fileKey || hit.cityFile || hit.city_file || ""),
      zip: String(hit.zip || hit.postal_code || "").trim() || null,
      source: "bases.json[array]",
    };
  }

  if (idx.bases && typeof idx.bases === "object") map = idx.bases;

  // Try direct normalized key
  const hit =
    map[norm] ||
    map[String(baseRaw || "").trim()] ||
    null;

  if (!hit) return null;

  return {
    cityKey: safeKey(hit.cityKey || hit.city_key || hit.city || ""),
    fileKey: safeKey(hit.file || hit.fileKey || hit.cityFile || hit.city_file || ""),
    zip: String(hit.zip || hit.postal_code || "").trim() || null,
    source: "bases.json[object]",
  };
}

function loadCityByFileKey(fileKey, canonicalCityKey) {
  const fk = safeKey(fileKey);
  if (!fk) throw new Error("Missing city fileKey.");
  if (__CITY_CACHE__.has(fk)) {
    const cached = __CITY_CACHE__.get(fk);
    return {
      ...cached,
      canonical_city_key: safeKey(canonicalCityKey || cached?.canonical_city_key || ""),
      cityFileUsed: fk,
    };
  }

  const filePath = __path.join(__CITIES_DIR, `${fk}.json`);
  if (!__fs.existsSync(filePath)) {
    throw new Error(`City JSON not found at ${filePath}`);
  }

  const raw = __fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  const out = {
    ...data,
    raw: data,
    canonical_city_key: safeKey(canonicalCityKey || ""),
    cityFileUsed: fk,
  };

  __CITY_CACHE__.set(fk, out);
  return out;
}

function deriveCityAndFile(profile, payTables) {
  const baseRaw = pickFirst(profile, ["pcs_base","pcsBase","base","duty_station","station","dutyStation"]);
  const baseName = String(baseRaw || "").trim();

  // 1) Prefer bases.json
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

  // 2) Fallback: try cityKey itself (if your cityKey matches a filename)
  const cityKeyCanon = safeKey(fromBases?.cityKey || "");
  if (cityKeyCanon && cityFileExists(cityKeyCanon)) {
    return { ok: true, base: baseName, cityKey: cityKeyCanon, fileKey: cityKeyCanon, zip: fromBases?.zip || null, source: "bases.json->cityKeyAsFile" };
  }

  // 3) Last resort: payTables mapping if present
  const norm = normalizeBaseName(baseName);
  const tbl = payTables?.CITY_BY_BASE || payTables?.CITY?.by_base || payTables?.city_by_base || null;
  if (tbl && typeof tbl === "object") {
    const mapped = tbl[norm] || tbl[baseName] || null;
    const ck = safeKey(mapped);
    if (ck && cityFileExists(ck)) return { ok: true, base: baseName, cityKey: ck, fileKey: ck, zip: null, source: "payTables.CITY_BY_BASE" };
  }

  // 4) Hard fallback: Fort-Sam-Houston if present, else first file in directory
  if (cityFileExists("Fort-Sam-Houston")) {
    return { ok: true, base: baseName, cityKey: "SanAntonio", fileKey: "Fort-Sam-Houston", zip: null, source: "fallback:Fort-Sam-Houston" };
  }

  const any = Array.from(listCityFiles())[0] || null;
  if (any) return { ok: true, base: baseName, cityKey: safeKey(any), fileKey: safeKey(any), zip: null, source: "fallback:firstCityFile" };

  return { ok: false, base: baseName, cityKey: null, fileKey: null, zip: null, source: "none" };
}

// -----------------------------
// //#4 Deterministic pay math (Active Duty focused)
// -----------------------------
function computeBasePay(rank, yos, payTables, missing) {
  let basePay = 0;
  if (rank && yos !== null) {
    const baseTable = payTables?.BASEPAY?.[rank];
    if (!baseTable) {
      missing.push("basepay_table_for_rank");
    } else {
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
  let bah = 0;

  if (!zip) {
    missing.push("bah_zip_missing");
    return 0;
  }
  if (!rank) {
    missing.push("bah_rank_missing");
    return 0;
  }

  // Prefer BAH_TX shape (your known PCSUnited dataset)
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

  // Support both shapes:
  // A) { with: {E-6: 2400}, without:{E-6: 1800} }
  // B) { with:{rank:}, without:{rank:} } (same)
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

  bah = Number(val) || 0;
  return bah;
}

function detectPayModel(profile) {
  const modeRaw = lower(profile?.mode);
  if (modeRaw) {
    if (["vet","veteran","retired","retiree","sep","separated","civ","civilian"].includes(modeRaw)) return "veteran";
    if (["ad","active","active_duty","activeduty"].includes(modeRaw)) return "active";
  }

  const modelRaw = lower(pickFirst(profile, ["pay_model","payModel","status","member_status","memberStatus","service_status","serviceStatus"]));
  const veteranWords = ["veteran","retired","retiree","separated","civilian"];
  const activeWords = ["active","activeduty","ad","active duty"];

  if (veteranWords.some((w) => modelRaw.includes(w))) return "veteran";
  if (activeWords.some((w) => modelRaw.includes(w))) return "active";

  return "active";
}

function computePay(profile, payTables, city, baseZipHint) {
  const missing = [];
  const payModel = detectPayModel(profile);

  const rank = normalizeRank(profile?.rank_paygrade || profile?.rank || "");
  const yos = toInt(profile?.yos ?? profile?.years_of_service ?? profile?.yearsOfService);

  const famRaw = profile?.family ?? profile?.dependents ?? profile?.has_dependents;
  const familyBool =
    String(famRaw).toLowerCase() === "true" ||
    famRaw === true ||
    (toInt(famRaw) || 0) >= 2;

  if (!rank) missing.push("rank_paygrade");
  if (yos === null) missing.push("yos");

  const basePay = computeBasePay(rank, yos, payTables, missing);

  // PCSUnited focus: Active Duty pay is deterministic (Base + BAS + BAH).
  if (payModel === "veteran") {
    // Keep structure, but no deterministic BAH/BAS assumed for vet mode here
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
      }
    };
  }

  // ZIP resolution priority:
  // 1) profile.zip
  // 2) bases.json provided zip
  // 3) city.zip inside city JSON
  // 4) payTables.BAH.base_to_zip lookup by base (if exists)
  let zip =
    String(profile?.zip || profile?.postal_code || "").trim() ||
    String(baseZipHint || "").trim() ||
    String(city?.zip || city?.postal_code || "").trim() ||
    "";

  if (!zip) {
    const baseRaw = pickFirst(profile, ["pcs_base","pcsBase","base","duty_station","station","dutyStation"]);
    const baseName = String(baseRaw || "").trim();
    const baseToZipRaw = payTables?.BAH?.base_to_zip || payTables?.BAH?.baseToZip || payTables?.BASE_ZIP || {};
    const baseToZipNorm = new Map();
    for (const [k, v] of Object.entries(baseToZipRaw || {})) {
      const nk = normalizeBaseName(k);
      if (nk) baseToZipNorm.set(nk, String(v || "").trim());
    }
    const derived = baseToZipNorm.get(normalizeBaseName(baseName));
    if (derived) zip = derived;
  }

  if (!zip) missing.push("bah_zip_missing");

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

// -----------------------------
// //#5 Supabase profile lookup
// -----------------------------
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars.");
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
// //#6 Optional mortgage (never blocks pay)
// -----------------------------
async function computeMortgageOptional(body) {
  if (typeof __mortgageHandler !== "function") {
    return {
      ok: false,
      error: __mortgageImportError || "mortgage.js unavailable",
      breakdown: { pi: 0, tax: 0, insurance: 0, hoa: 0, pmi: 0, allIn: 0 },
      meta: { warnings: ["mortgage_disabled_to_prevent_brain_crash"] },
    };
  }

  try {
    const evt = { httpMethod: "POST", headers: {}, body: JSON.stringify(body || {}) };
    const res = await __mortgageHandler(evt);
    const parsed = res?.body ? JSON.parse(res.body) : null;
    if (res?.statusCode !== 200 || !parsed || parsed.ok !== true) {
      return {
        ok: false,
        error: parsed?.error || `mortgage.js failed (status=${res?.statusCode ?? "unknown"})`,
        breakdown: parsed?.breakdown || { pi: 0, tax: 0, insurance: 0, hoa: 0, pmi: 0, allIn: 0 },
        meta: parsed?.meta || null,
      };
    }
    return parsed;
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      breakdown: { pi: 0, tax: 0, insurance: 0, hoa: 0, pmi: 0, allIn: 0 },
      meta: { warnings: ["mortgage_handler_exception"] },
    };
  }
}

// -----------------------------
// //#7 Netlify handler
// -----------------------------
export async function handler(event) {
  try {
    await ensureDeps();

    // Preflight success (this fixes the “preflight doesn’t have HTTP ok status” problem)
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: buildCorsHeaders(event), body: "" };
    }

    if (event.httpMethod === "GET") {
      return respond(event, 200, {
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        note: "POST JSON: { email, bedrooms?, cityKey? (optional), overrides? (optional) }",
        mortgageAvailable: typeof __mortgageHandler === "function",
        mortgageImportError: __mortgageImportError || null,
      });
    }

    if (event.httpMethod !== "POST") {
      return respond(event, 405, { ok: false, schemaVersion: SCHEMA_VERSION, error: "Method not allowed." });
    }

    const body = JSON.parse(event.body || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const bedrooms = toInt(body.bedrooms) ?? 4;

    if (!email) return respond(event, 400, { ok: false, schemaVersion: SCHEMA_VERSION, error: "Missing email." });

    const payTables = loadPayTables();
    const profile = await fetchProfileByEmail(email);

    // Resolve city via PCS base (bases.json) and load that city file
    const cityPick = deriveCityAndFile(profile, payTables);

    let city = null;
    let cityError = null;

    try {
      if (cityPick.ok && cityPick.fileKey) {
        city = loadCityByFileKey(cityPick.fileKey, cityPick.cityKey || null);
      } else {
        // fallback to Fort-Sam-Houston if present
        city = loadCityByFileKey("Fort-Sam-Houston", "SanAntonio");
      }
    } catch (e) {
      cityError = String(e?.message || e);
      city = null;
    }

    // ✅ Compute PAY no matter what
    const computed = computePay(profile, payTables, city, cityPick?.zip || null);

    // Optional mortgage (never blocks pay)
    const mortgageEngine = await computeMortgageOptional(body);

    const mortgage = {
      ok: mortgageEngine?.ok === true,
      breakdown: mortgageEngine?.breakdown || null,
      aprUsed: Number(mortgageEngine?.apr || 0) || 0,
      termYears: Number(mortgageEngine?.termYears || 0) || 0,
      loanAmount: Number(mortgageEngine?.loanAmount || 0) || 0,

      principalInterestMonthly: Number(mortgageEngine?.breakdown?.pi || 0) || 0,
      taxMonthly: Number(mortgageEngine?.breakdown?.tax || 0) || 0,
      insuranceMonthly: Number(mortgageEngine?.breakdown?.insurance || 0) || 0,
      hoaMonthly: Number(mortgageEngine?.breakdown?.hoa || 0) || 0,
      pmiMonthly: Number(mortgageEngine?.breakdown?.pmi || 0) || 0,
      totalMonthly: Number(mortgageEngine?.breakdown?.allIn || 0) || 0,

      source: mortgageEngine?.ok ? "mortgage.js" : "disabled",
      error: mortgageEngine?.ok ? null : (mortgageEngine?.error || null),
      meta: mortgageEngine?.meta || null,
    };

    return respond(event, 200, {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      input: { email, bedrooms },

      debug: {
        payTablesPathUsed: __PAY_TABLES_PATH_USED__ || null,
        basesIndexPathUsed: __BASES_INDEX_PATH_USED__ || null,
        mortgageAvailable: typeof __mortgageHandler === "function",
        mortgageImportError: __mortgageImportError || null,
        cityPick,
        cityLoadError: cityError || null,
        cityFileUsed: city?.cityFileUsed || null,
      },

      profile,
      pay: computed.pay,
      city,
      missing: computed.missing || [],

      mortgage,
      estimatedMonthlyMortgage: mortgage.totalMonthly,
    });
  } catch (e) {
    return respond(event, 500, { ok: false, schemaVersion: SCHEMA_VERSION, error: String(e?.message || e) });
  }
}
