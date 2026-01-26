// netlify/functions/brain.js
// ============================================================
// PCSUnited • CENTRAL BRAIN (v2.0.0) — Pay + City (bases.json index) + Mortgage Breakdown
//
// ✅ PCSUnited PATHS (as provided):
// - Pay Tables: netlify/functions/data/militaryPayTables.json
// - Cities Index: netlify/functions/cities/bases.json
//
// ✅ DESIGN GOALS:
// - Deterministic Pay (Base Pay + BAS + BAH) from pay tables
// - City payload loaded from bases.json (NOT per-base json files)
// - Mortgage math delegated to mortgage.js (single source of truth)
// - Robust CORS preflight support
// - Safe response: returns public profile by default (no sensitive fields)
// ============================================================

const SCHEMA_VERSION = "1.2";

// -----------------------------
// //#0 Runtime deps (CJS/ESM safe)
// -----------------------------
let __fs = null;
let __path = null;
let __createClient = null;
let __mortgageHandler = null;

let __ROOT = null;
let __PAY_TABLES_PATH = null;
let __BASES_INDEX_PATH = null;

async function ensureDeps() {
  if (__fs && __path && __createClient && __mortgageHandler && __ROOT) return;

  const fsMod = await import("node:fs");
  const pathMod = await import("node:path");
  __fs = fsMod.default || fsMod;
  __path = pathMod.default || pathMod;

  const sbMod = await import("@supabase/supabase-js");
  __createClient = sbMod.createClient;

  const mortMod = await import("./mortgage.js");
  __mortgageHandler = mortMod?.handler;
  if (typeof __mortgageHandler !== "function") {
    throw new Error("mortgage.js handler not found. Ensure netlify/functions/mortgage.js exports `handler`.");
  }

  __ROOT = process.cwd(); // /var/task

  // PCSUnited fixed paths
  __PAY_TABLES_PATH = __path.join(__ROOT, "netlify", "functions", "data", "militaryPayTables.json");
  __BASES_INDEX_PATH = __path.join(__ROOT, "netlify", "functions", "cities", "bases.json");
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
// //#2.5 Pay model + overrides
// -----------------------------
function detectPayModel(profile) {
  const modeRaw = lower(profile?.mode);

  if (modeRaw) {
    if (["vet", "veteran", "retired", "retiree", "sep", "separated", "civ", "civilian"].includes(modeRaw)) return "veteran";
    if (["ad", "active", "active_duty", "activeduty"].includes(modeRaw)) return "active";
  }

  const modelRaw = lower(
    pickFirst(profile, [
      "pay_model",
      "payModel",
      "status",
      "member_status",
      "memberStatus",
      "service_status",
      "serviceStatus",
    ]) || ""
  );

  const explicitVeteran =
    String(profile?.veteran ?? profile?.is_veteran ?? profile?.isVeteran ?? "").toLowerCase() === "true" ||
    profile?.veteran === true ||
    profile?.is_veteran === true ||
    profile?.isVeteran === true;

  const explicitActive =
    String(profile?.active_duty ?? profile?.activeDuty ?? profile?.is_active_duty ?? "").toLowerCase() === "true" ||
    profile?.active_duty === true ||
    profile?.activeDuty === true ||
    profile?.is_active_duty === true;

  if (explicitVeteran) return "veteran";
  if (["veteran", "retired", "retiree", "separated", "civilian"].some((w) => modelRaw.includes(w))) return "veteran";

  if (explicitActive) return "active";
  if (["active", "activeduty", "ad", "active duty"].some((w) => modelRaw.includes(w))) return "active";

  return "active";
}

function deriveDependentsFromFamilySize(profile) {
  const familySize =
    toInt(pickFirst(profile, ["familySize", "family_size", "family", "dependents_count", "dependentsCount"])) ?? 1;

  const hasSpouse = familySize >= 2;
  const kidsUnder18 = Math.max(familySize - 2, 0);

  return { familySize, hasSpouse, kidsUnder18 };
}

function applyOverridesToProfile(profile, overrides) {
  const o = overrides && typeof overrides === "object" ? overrides : null;
  if (!o) return { profileEffective: { ...profile }, overridesApplied: [] };

  const ALLOWED = new Set([
    "rank",
    "rank_paygrade",
    "rankPaygrade",
    "yos",
    "years_of_service",
    "yearsOfService",
    "zip",
    "postal_code",
    "base",
    "duty_station",
    "station",
    "dutyStation",
    "pcs_base",
    "pcsBase",
    "family",
    "familySize",
    "family_size",
    "va_disability",
    "vaDisability",
    "va_rating",
    "vaRating",
    "retirement_system",
    "retirementSystem",

    "price",
    "home_price",
    "projected_home_price",
    "projectedHomePrice",
    "dpPct",
    "down_payment_pct",
    "creditScore",
    "credit_score",
    "apr",
    "taxRate",
    "insRate",
    "hoa",
    "hoa_monthly",
    "pmiRate",
    "loanType",
    "loan_type",
    "termYears",
    "term_years",

    "mode",
  ]);

  const applied = [];
  const next = { ...profile };

  for (const [k, v] of Object.entries(o)) {
    if (!ALLOWED.has(k)) continue;
    if (v === undefined) continue;
    const val = typeof v === "string" && v.trim() === "" ? null : v;
    next[k] = val;
    applied.push(k);
  }

  return { profileEffective: next, overridesApplied: applied };
}

// -----------------------------
// //#3 File loading (Netlify-safe)
// -----------------------------
let __PAY_TABLES_CACHE__ = null;
let __BASES_INDEX_CACHE__ = null;

function loadPayTables() {
  if (__PAY_TABLES_CACHE__) return __PAY_TABLES_CACHE__;
  if (!__PAY_TABLES_PATH) throw new Error("Pay tables path not initialized.");
  if (!__fs.existsSync(__PAY_TABLES_PATH)) {
    throw new Error(
      `militaryPayTables.json not found at: ${__PAY_TABLES_PATH}\n` +
      `Fix: ensure netlify.toml includes [functions].included_files = ["netlify/functions/data/**","netlify/functions/cities/**"]`
    );
  }
  const raw = __fs.readFileSync(__PAY_TABLES_PATH, "utf8");
  __PAY_TABLES_CACHE__ = JSON.parse(raw);
  return __PAY_TABLES_CACHE__;
}

function loadBasesIndex() {
  if (__BASES_INDEX_CACHE__) return __BASES_INDEX_CACHE__;
  if (!__BASES_INDEX_PATH) throw new Error("bases.json path not initialized.");
  if (!__fs.existsSync(__BASES_INDEX_PATH)) {
    throw new Error(
      `bases.json not found at: ${__BASES_INDEX_PATH}\n` +
      `Fix: ensure netlify.toml includes [functions].included_files = ["netlify/functions/data/**","netlify/functions/cities/**"]`
    );
  }
  const raw = __fs.readFileSync(__BASES_INDEX_PATH, "utf8");
  __BASES_INDEX_CACHE__ = JSON.parse(raw);
  return __BASES_INDEX_CACHE__;
}

// -----------------------------
// //#3.5 City resolution (base -> cityKey) + bases.json loader
// -----------------------------
function deriveCityKeyFromBase(profile, payTables) {
  const baseRaw = pickFirst(profile, ["base", "duty_station", "station", "dutyStation", "pcs_base", "pcsBase"]);
  const norm = normalizeBaseName(baseRaw);
  if (!norm) return { cityKey: null, source: "none", base: String(baseRaw || "").trim() };

  // Prefer authoritative payTables mapping if present
  const tbl =
    payTables?.CITY_BY_BASE ||
    payTables?.CITY?.by_base ||
    payTables?.CITY?.byBase ||
    payTables?.city_by_base ||
    null;

  if (tbl && typeof tbl === "object") {
    const mapped = tbl[norm] || tbl[String(baseRaw || "").trim()] || null;
    if (mapped) return { cityKey: safeKey(mapped), source: "payTables.CITY_BY_BASE", base: String(baseRaw || "").trim() };
  }

  // Small internal fallback map (expand later if needed)
  const MAP = {
    NELLIS: "LasVegas",
    NELLISAFB: "LasVegas",
    DAVISMONTHAN: "Tucson",
    DAVISMONTHANAFB: "Tucson",
    FORTSAMHOUSTON: "SanAntonio",
    FORTSAM: "SanAntonio",
    LACKLAND: "SanAntonio",
    RANDOLPH: "SanAntonio",
    LUKE: "Phoenix",
    LUKEAFB: "Phoenix",
    DYESS: "Abilene",
    KIRTLAND: "Albuquerque",
    LAUGHLIN: "DelRio",
  };

  const hit = MAP[norm] || null;
  return { cityKey: hit ? safeKey(hit) : null, source: hit ? "internalBaseCityMap" : "none", base: String(baseRaw || "").trim() };
}

function cityBaselineFromCityPayload(data) {
  // Normalize market + targets to be schema-friendly
  const marketRaw = data?.market || data?.housing?.market || data?.realEstate?.market || {};
  const targetsRaw = data?.targets || data?.housing?.targets || data?.realEstate?.targets || {};

  const zillowAvg = toNum(marketRaw?.zillow_average_home_value);
  const medianSale = toNum(marketRaw?.median_sale_price_current);
  const medianList = toNum(marketRaw?.median_listing_price_realtor);
  const ownerOccMedian = toNum(data?.housing?.median_value_owner_occupied);

  const avgHome =
    zillowAvg ??
    medianSale ??
    medianList ??
    ownerOccMedian ??
    toNum(data?.avg_home_value ?? data?.average_home_value ?? data?.avgHome ?? data?.city_avg_home) ??
    null;

  const avgHomeSource =
    (zillowAvg != null && "housing.market.zillow_average_home_value") ||
    (medianSale != null && "housing.market.median_sale_price_current") ||
    (medianList != null && "housing.market.median_listing_price_realtor") ||
    (ownerOccMedian != null && "housing.median_value_owner_occupied") ||
    null;

  const bedrooms =
    (data?.bedrooms && typeof data.bedrooms === "object" ? data.bedrooms : null) ||
    (data?.by_bedroom && typeof data.by_bedroom === "object" ? data.by_bedroom : null) ||
    (data?.byBedroom && typeof data.byBedroom === "object" ? data.byBedroom : null) ||
    null;

  function avgFromBedroomPath(obj, getter) {
    if (!obj || typeof obj !== "object") return null;
    const vals = [];
    for (const k of Object.keys(obj)) {
      const v = getter(obj[k]);
      const n = toNum(v);
      if (n != null && n > 0) vals.push(n);
    }
    if (!vals.length) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  const derivedTargetRent = avgFromBedroomPath(
    bedrooms,
    (b) => b?.rent_monthly?.avg ?? b?.rentMonthly?.avg ?? b?.rent?.avg
  );

  const targetRent =
    toNum(data?.target_rent ?? data?.targetRent ?? targetsRaw?.target_rent ?? targetsRaw?.targetRent) ??
    derivedTargetRent ??
    null;

  return {
    ...data,
    market: {
      ...marketRaw,
      avg_home_value: avgHome,
      average_home_value: avgHome,
      avgHome: avgHome,
      city_avg_home: avgHome,
      avg_home_value_source: avgHomeSource,
    },
    targets: targetsRaw,
    bedrooms: bedrooms,
    target_rent: targetRent,
    targetRent: targetRent,

    // Also provide commonly-used aliases (helps front-end)
    avg_home_value: toNum(data?.avg_home_value ?? data?.average_home_value ?? data?.avgHome ?? data?.city_avg_home) ?? avgHome ?? null,
    average_home_value: toNum(data?.average_home_value) ?? (toNum(data?.avg_home_value) ?? avgHome ?? null),
    avgHome: toNum(data?.avgHome) ?? (toNum(data?.avg_home_value) ?? avgHome ?? null),
    city_avg_home: toNum(data?.city_avg_home) ?? (toNum(data?.avg_home_value) ?? avgHome ?? null),
  };
}

function tryPickCityFromBasesIndex({ basesIndex, baseRaw, baseNorm, cityKey }) {
  // This function is intentionally defensive: bases.json may use different shapes.

  const cityKeyClean = safeKey(cityKey || "");
  const baseRawStr = String(baseRaw || "").trim();
  const baseNormStr = String(baseNorm || "");

  const candidates = [];

  // Candidate keys to try in maps
  if (baseRawStr) candidates.push(baseRawStr);
  if (baseNormStr) candidates.push(baseNormStr);
  if (cityKeyClean) candidates.push(cityKeyClean);

  // Candidate containers
  const containers = [];

  if (basesIndex && typeof basesIndex === "object") {
    containers.push(basesIndex);

    // Common shapes
    if (basesIndex.bases && typeof basesIndex.bases === "object") containers.push(basesIndex.bases);
    if (basesIndex.by_base && typeof basesIndex.by_base === "object") containers.push(basesIndex.by_base);
    if (basesIndex.byBase && typeof basesIndex.byBase === "object") containers.push(basesIndex.byBase);
    if (basesIndex.BASES && typeof basesIndex.BASES === "object") containers.push(basesIndex.BASES);

    if (basesIndex.cities && typeof basesIndex.cities === "object") containers.push(basesIndex.cities);
    if (basesIndex.by_city && typeof basesIndex.by_city === "object") containers.push(basesIndex.by_city);
    if (basesIndex.byCity && typeof basesIndex.byCity === "object") containers.push(basesIndex.byCity);
  }

  // 1) Direct lookup by candidate keys
  for (const c of containers) {
    for (const k of candidates) {
      if (!k) continue;
      if (c[k] && typeof c[k] === "object") return { ok: true, pickedFrom: "direct", keyUsed: k, record: c[k] };
    }
  }

  // 2) If a container is keyed by normalized base names, attempt normalized scan
  for (const c of containers) {
    for (const [k, v] of Object.entries(c)) {
      if (!v || typeof v !== "object") continue;
      if (normalizeBaseName(k) === baseNormStr) return { ok: true, pickedFrom: "normalizedKeyMatch", keyUsed: k, record: v };
    }
  }

  // 3) If basesIndex has an array of bases/cities
  const arraysToTry = [];
  if (Array.isArray(basesIndex?.bases)) arraysToTry.push(basesIndex.bases);
  if (Array.isArray(basesIndex?.items)) arraysToTry.push(basesIndex.items);
  if (Array.isArray(basesIndex)) arraysToTry.push(basesIndex);

  for (const arr of arraysToTry) {
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const itemBase = pickFirst(item, ["base", "base_name", "baseName", "installation", "name"]);
      const itemCityKey = pickFirst(item, ["cityKey", "city_key", "city", "canonical_city_key"]);
      const nb = normalizeBaseName(itemBase);
      const ck = safeKey(itemCityKey);

      if (baseNormStr && nb === baseNormStr) return { ok: true, pickedFrom: "arrayBaseMatch", keyUsed: String(itemBase || ""), record: item };
      if (cityKeyClean && ck === cityKeyClean) return { ok: true, pickedFrom: "arrayCityKeyMatch", keyUsed: String(itemCityKey || ""), record: item };
    }
  }

  return { ok: false, pickedFrom: "none", keyUsed: null, record: null };
}

function loadCityFromBasesIndex({ profile, resolvedCityKey }) {
  const basesIndex = loadBasesIndex();

  const baseRaw = pickFirst(profile, ["base", "duty_station", "station", "dutyStation", "pcs_base", "pcsBase"]);
  const baseNorm = normalizeBaseName(baseRaw);

  const pick = tryPickCityFromBasesIndex({
    basesIndex,
    baseRaw,
    baseNorm,
    cityKey: resolvedCityKey,
  });

  if (!pick.ok || !pick.record) {
    const knownTopKeys = basesIndex && typeof basesIndex === "object" ? Object.keys(basesIndex).slice(0, 25) : [];
    throw new Error(
      `City not found in bases.json index. base="${String(baseRaw || "").trim()}" cityKey="${String(resolvedCityKey || "").trim()}". ` +
      `Try verifying bases.json structure. topKeys=[${knownTopKeys.join(", ")}]`
    );
  }

  const normalized = cityBaselineFromCityPayload(pick.record);

  return {
    ...normalized,
    source: "bases.json",
    canonical_city_key: safeKey(resolvedCityKey || pick.keyUsed || ""),
    basesIndexPick: { pickedFrom: pick.pickedFrom, keyUsed: pick.keyUsed },
  };
}

// -----------------------------
// //#4 Deterministic pay math
// -----------------------------
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
  let bah = 0;
  if (zip && rank) {
    const bahByZip = payTables?.BAH?.by_zip || payTables?.BAH?.byZip || null;
    const bahZip = (bahByZip && bahByZip?.[zip]) || payTables?.BAH_TX?.[zip] || payTables?.BAH?.[zip] || null;

    if (!bahZip) {
      missing.push("bah_zip_not_found");
    } else {
      const bucket = familyBool ? bahZip.with : bahZip.without;
      if (!bucket) {
        missing.push("bah_bucket_missing");
      } else {
        const val = bucket?.[rank];
        if (val == null) missing.push("bah_rank_not_found");
        else bah = Number(val) || 0;
      }
    }
  } else {
    if (!zip) missing.push("bah_zip_missing");
  }
  return bah;
}

function computeVaDisability(profile, payTables, missing) {
  const pct = toInt(profile?.va_disability ?? profile?.vaDisability ?? profile?.va_rating ?? profile?.vaRating);
  if (pct === null) {
    missing.push("va_disability");
    return { amount: 0, debug: { pct: null, method: "missing" } };
  }

  const pctKey = String(pct);
  const full = payTables?.DISABILITY_FULL?.[pctKey] || null;

  const { familySize, hasSpouse, kidsUnder18 } = deriveDependentsFromFamilySize(profile);

  if (full && typeof full === "object") {
    let baseKey = "veteran";
    if (hasSpouse && kidsUnder18 >= 1) baseKey = "veteran_spouse_one_child";
    else if (hasSpouse && kidsUnder18 === 0) baseKey = "veteran_spouse";
    else if (!hasSpouse && kidsUnder18 >= 1) baseKey = "veteran_one_child";

    const base = Number(full?.[baseKey]) || 0;
    const addPerChild = Number(full?.additional_child_under_18) || 0;
    const extraKids = Math.max(kidsUnder18 - 1, 0);

    const amount = base + extraKids * addPerChild;

    return {
      amount,
      debug: { pct, method: "DISABILITY_FULL", familySize, hasSpouse, kidsUnder18, baseKey, base, addPerChild, extraKids },
    };
  }

  const simple = Number(payTables?.DISABILITY?.[pctKey]) || 0;
  if (!simple) missing.push("va_disability_table_missing");
  return { amount: simple, debug: { pct, method: "DISABILITY" } };
}

function computeRetirementPay(profile, rank, yos, payTables, missing) {
  if (yos === null) {
    missing.push("yos");
    return { amount: 0, debug: { method: "missing_yos" } };
  }

  if (yos < 20) return { amount: 0, debug: { method: "ineligible_yos<20", yos } };

  const baseTable = payTables?.BASEPAY?.[rank] || null;
  if (!baseTable) {
    missing.push("basepay_table_for_rank");
    return { amount: 0, debug: { method: "missing_basepay_table" } };
  }

  const keys = Object.keys(baseTable).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const eligible = keys.filter((k) => k <= yos);
  if (!eligible.length) {
    missing.push("high3_steps_missing");
    return { amount: 0, debug: { method: "no_steps<=yos", yos } };
  }

  const lastSteps = eligible.slice(Math.max(eligible.length - 3, 0));
  const pays = lastSteps.map((k) => Number(baseTable[String(k)]) || 0).filter((v) => v > 0);
  if (!pays.length) {
    missing.push("high3_values_missing");
    return { amount: 0, debug: { method: "no_pay_values" } };
  }

  const high3 = pays.reduce((a, b) => a + b, 0) / pays.length;

  const sysRaw = lower(profile?.retirement_system || profile?.retirementSystem || "high3");
  const sys = sysRaw === "brs" || sysRaw === "blended" ? "brs" : "high3";

  const multPerYear = toNum(payTables?.RETIREMENT?.systems?.[sys]?.multiplier_per_year) ?? (sys === "brs" ? 0.02 : 0.025);
  const rawMultiplier = multPerYear * yos;

  const cap = sys === "brs" ? 0.6 : 0.75;
  const multiplier = Math.min(rawMultiplier, cap);

  const amount = high3 * multiplier;

  return {
    amount,
    debug: { method: "high3_estimate_from_BASEPAY", sys, multPerYear, yos, multiplier, high3, stepsUsed: lastSteps, paysUsed: pays },
  };
}

function computePay(profile, payTables) {
  const missing = [];

  const payModel = detectPayModel(profile);

  const rank = normalizeRank(profile?.rank_paygrade || profile?.rank || "");
  const yos = toInt(profile?.yos ?? profile?.years_of_service ?? profile?.yearsOfService);

  const famRaw = profile?.family ?? profile?.dependents ?? profile?.has_dependents;
  const familyBool = String(famRaw).toLowerCase() === "true" || famRaw === true || (toInt(famRaw) || 0) >= 2;

  const explicitZip = String(profile?.zip || profile?.postal_code || "").trim();
  const baseName = String(profile?.base || profile?.duty_station || profile?.station || "").trim();
  let zip = explicitZip;

  if (!rank) missing.push("rank_paygrade");
  if (yos === null) missing.push("yos");

  const basePay = computeBasePay(rank, yos, payTables, missing);

  if (payModel === "veteran") {
    const bas = 0;
    const bah = 0;

    const va = computeVaDisability(profile, payTables, missing);
    const ret = computeRetirementPay(profile, rank, yos, payTables, missing);

    const retirementPay = Number(ret.amount) || 0;
    const vaDisabilityPay = Number(va.amount) || 0;

    const totalPay = retirementPay + vaDisabilityPay;

    return {
      ok: totalPay > 0,
      missing,
      pay: {
        ok: totalPay > 0,
        payModel,
        payAccuracy: "deterministic_va + estimated_retirement",
        basePay,
        bas,
        bah,
        retirementPay,
        vaDisabilityPay,
        totalPay,
        total: totalPay,
        zipUsed: zip || null,
        familyUsed: familyBool,
        rankUsed: rank || null,
        yosUsed: yos,
        debug: { retirement: ret.debug, va: va.debug },
      },
    };
  }

  // Active duty: derive zip from base if missing
  if (!zip && baseName) {
    const baseToZipRaw = payTables?.BAH?.base_to_zip || payTables?.BAH?.baseToZip || payTables?.BASE_ZIP || {};
    const baseToZipNorm = new Map();
    for (const [k, v] of Object.entries(baseToZipRaw || {})) {
      const nk = normalizeBaseName(k);
      if (nk) baseToZipNorm.set(nk, String(v || "").trim());
    }

    const derived = baseToZipNorm.get(normalizeBaseName(baseName));
    if (derived) zip = derived;
    else missing.push("bah_base_zip_missing");
  }

  const bas = computeBAS(rank, payTables);
  const bah = computeBAH(rank, familyBool, zip, payTables, missing);
  const totalPay = basePay + bas + bah;

  return {
    ok: totalPay > 0,
    missing,
    pay: {
      ok: totalPay > 0,
      payModel,
      payAccuracy: "deterministic",
      basePay,
      bah,
      bas,
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
// //#4.5 Mortgage (NO MATH) — call mortgage.js + map output
// -----------------------------
function pickMortgagePrice({ body, profile, city, bedrooms }) {
  const bodyPrice = toNum(body?.price ?? body?.homePrice ?? body?.purchase_price ?? body?.purchasePrice);
  const profPrice = toNum(profile?.price ?? profile?.home_price ?? profile?.projected_home_price ?? profile?.projectedHomePrice);

  const bedsKey = String(bedrooms ?? 4);
  const bedsRoot =
    city?.bedrooms ||
    city?.raw?.bedrooms ||
    city?.by_bedroom ||
    city?.raw?.by_bedroom ||
    city?.byBedroom ||
    city?.raw?.byBedroom ||
    null;

  let bedPrice = null;
  if (bedsRoot && typeof bedsRoot === "object") {
    const b = bedsRoot[bedsKey] || bedsRoot[Number(bedsKey)] || null;
    if (b) {
      const block = b?.home_price ?? b?.homePrice ?? b?.price ?? b?.home_value;
      const avg = typeof block === "object" ? toNum(block?.avg ?? block?.value ?? block?.amount) : toNum(block);
      const low = typeof block === "object" ? toNum(block?.low) : null;
      const high = typeof block === "object" ? toNum(block?.high) : null;
      bedPrice = avg ?? (low != null && high != null ? Math.round((low + high) / 2) : null);
    }
  }

  const cityAvg =
    toNum(city?.avg_home_value ?? city?.average_home_value ?? city?.avgHome ?? city?.city_avg_home) ??
    toNum(city?.market?.avg_home_value ?? city?.market?.zillow_average_home_value) ??
    null;

  const price = bodyPrice ?? profPrice ?? bedPrice ?? cityAvg ?? 0;

  const source =
    (bodyPrice != null && "body.price") ||
    (profPrice != null && "profile.price") ||
    (bedPrice != null && "city.bedrooms[bed].home_price") ||
    (cityAvg != null && "city.avg_home_value") ||
    "none";

  return { price, source };
}

function defaultPmiRate({ loanType, dpPct }) {
  const lt = String(loanType || "").trim().toLowerCase();
  if (lt === "va") return 0;
  if (lt === "fha") return 0.55;
  if (dpPct >= 20) return 0;
  return 0.5;
}

async function callMortgageEngine(payload) {
  const evt = { httpMethod: "POST", headers: {}, body: JSON.stringify(payload || {}) };
  const res = await __mortgageHandler(evt);

  let out = null;
  try { out = res?.body ? JSON.parse(res.body) : null; } catch (e) { out = null; }

  return { res, out };
}

async function computeMortgageEstimate({ body, profile, city, bedrooms }) {
  const sources = {};
  const { price, source: priceSource } = pickMortgagePrice({ body, profile, city, bedrooms });
  sources.price = priceSource;

  if (!price || price <= 0) {
    return {
      ok: false,
      breakdown: { principalInterest: 0, propertyTax: 0, insurance: 0, hoa: 0, pmi: 0, totalMonthly: 0 },
      assumptions: { note: "No price available yet." },
      sources,
      meta: { error: null },
    };
  }

  const dpPct =
    toNum(body?.dpPct ?? body?.downPaymentPct ?? profile?.dpPct ?? profile?.down_payment_pct) ??
    toNum(city?.mortgage_assumptions?.down_payment_percent) ??
    5;

  sources.dpPct =
    body?.dpPct != null || body?.downPaymentPct != null ? "body.dpPct"
    : profile?.dpPct != null || profile?.down_payment_pct != null ? "profile.dpPct"
    : city?.mortgage_assumptions?.down_payment_percent != null ? "city.mortgage_assumptions.down_payment_percent"
    : "default:5";

  const termYears =
    toInt(body?.termYears ?? body?.term ?? profile?.termYears ?? profile?.term_years) ??
    toInt(city?.mortgage_assumptions?.term_years) ??
    30;

  sources.termYears =
    body?.termYears != null || body?.term != null ? "body.termYears"
    : profile?.termYears != null || profile?.term_years != null ? "profile.termYears"
    : city?.mortgage_assumptions?.term_years != null ? "city.mortgage_assumptions.term_years"
    : "default:30";

  const creditScore = toInt(body?.creditScore ?? profile?.creditScore ?? profile?.credit_score) ?? null;

  const bodyApr = toNum(body?.apr);
  const profileApr = toNum(profile?.apr);

  const aprFallbackNoScore =
    profileApr ??
    toNum(city?.mortgage_assumptions?.apr_percent) ??
    7.0;

  const aprOverrideCandidate =
    bodyApr ??
    (creditScore == null ? aprFallbackNoScore : null);

  sources.apr =
    bodyApr != null ? "body.apr"
    : creditScore != null ? "mortgage.js.aprFromCreditScore(creditScore)"
    : profileApr != null ? "profile.apr"
    : city?.mortgage_assumptions?.apr_percent != null ? "city.mortgage_assumptions.apr_percent"
    : "default:7.0";

  const taxRatePct =
    toNum(body?.taxRate ?? profile?.taxRate) ??
    toNum(city?.tax_rate ?? city?.property_tax_rate ?? city?.raw?.property_tax_rate) ??
    1.2;

  sources.taxRate =
    body?.taxRate != null ? "body.taxRate"
    : profile?.taxRate != null ? "profile.taxRate"
    : city?.tax_rate != null ? "city.tax_rate"
    : (city?.property_tax_rate != null || city?.raw?.property_tax_rate != null) ? "city.property_tax_rate"
    : "default:1.20";

  const insRatePct =
    toNum(body?.insRate ?? profile?.insRate) ??
    toNum(city?.insurance_rate ?? city?.raw?.insurance_rate) ??
    0.5;

  sources.insRate =
    body?.insRate != null ? "body.insRate"
    : profile?.insRate != null ? "profile.insRate"
    : (city?.insurance_rate != null || city?.raw?.insurance_rate != null) ? "city.insurance_rate"
    : "default:0.50";

  const hoa =
    toNum(body?.hoa ?? profile?.hoa ?? profile?.hoa_monthly ?? city?.hoa_monthly ?? city?.raw?.hoa_monthly) ?? 0;

  sources.hoa =
    body?.hoa != null ? "body.hoa"
    : (profile?.hoa != null || profile?.hoa_monthly != null) ? "profile.hoa_monthly"
    : (city?.hoa_monthly != null || city?.raw?.hoa_monthly != null) ? "city.hoa_monthly"
    : "default:0";

  const loanTypeRaw = String(body?.loanType ?? profile?.loanType ?? profile?.loan_type ?? "").trim();
  const loanType = loanTypeRaw ? loanTypeRaw : "conventional";

  const pmiRatePct = toNum(body?.pmiRate ?? profile?.pmiRate) ?? defaultPmiRate({ loanType, dpPct });

  sources.pmiRate =
    body?.pmiRate != null ? "body.pmiRate"
    : profile?.pmiRate != null ? "profile.pmiRate"
    : "defaultPmiRate(loanType,dpPct)";

  const mortgagePayload = {
    price: price,
    down: dpPct,
    creditScore: creditScore ?? undefined,
    termYears: termYears,
    taxRate: Number.isFinite(taxRatePct) ? (taxRatePct / 100) : undefined,
    insuranceAnnual: Number.isFinite(insRatePct) ? (price * (insRatePct / 100)) : undefined,
    hoaMonthly: Number.isFinite(hoa) ? hoa : 0,
    loanType: String(loanType || "conventional").toLowerCase(),
    aprOverride:
      (bodyApr != null || creditScore == null)
        ? (Number.isFinite(aprOverrideCandidate) ? aprOverrideCandidate : undefined)
        : undefined,
    pmiRate: Number.isFinite(pmiRatePct) ? (pmiRatePct / 100) : undefined,
  };

  let engine = null;
  let engineErr = null;

  try {
    const { res, out } = await callMortgageEngine(mortgagePayload);
    engine = out;
    if (!res || res.statusCode !== 200 || !out || out.ok !== true) {
      engineErr = out?.error || `mortgage.js failed (status=${res?.statusCode ?? "unknown"})`;
    }
  } catch (e) {
    engineErr = String(e?.message || e);
    engine = null;
  }

  if (engineErr || !engine) {
    return {
      ok: false,
      breakdown: { principalInterest: 0, propertyTax: 0, insurance: 0, hoa: 0, pmi: 0, totalMonthly: 0 },
      assumptions: { note: "Mortgage engine error.", error: engineErr },
      sources,
      meta: { error: engineErr },
    };
  }

  const pi = Number(engine?.breakdown?.pi || 0) || 0;
  const tax = Number(engine?.breakdown?.tax || 0) || 0;
  const ins = Number(engine?.breakdown?.insurance || 0) || 0;
  const hoaMo = Number(engine?.breakdown?.hoa || 0) || 0;
  const pmi = Number(engine?.breakdown?.pmi || 0) || 0;
  const totalMonthly = Number(engine?.breakdown?.allIn || 0) || 0;

  const downPayment = Number(engine?.downPayment || 0) || 0;
  const downPercent = Number(engine?.downPercent || 0) || 0;
  const loanAmount = Number(engine?.loanAmount || 0) || 0;
  const aprUsed = Number(engine?.apr || 0) || 0;
  const termUsed = Number(engine?.termYears || termYears) || termYears;

  return {
    ok: totalMonthly > 0,
    breakdown: {
      principalInterest: pi,
      propertyTax: tax,
      insurance: ins,
      hoa: hoaMo,
      pmi: pmi,
      totalMonthly: totalMonthly,
    },
    assumptions: {
      price: Number(engine?.price ?? price) || price,
      dpPct: downPercent || dpPct,
      dpAmt: downPayment,
      loan: loanAmount,
      apr: aprUsed,
      termYears: termUsed,
      taxRate: taxRatePct,
      insRate: insRatePct,
      hoa: hoaMo,
      pmiRate: pmiRatePct,
      loanType: loanType || undefined,
      creditScore: creditScore ?? undefined,
    },
    sources,
    meta: {
      aprSource: engine?.aprSource ?? null,
      warnings: engine?.meta?.warnings ?? [],
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

function buildPublicProfile(profileEffective) {
  // Keep this response safe for the browser.
  // Add fields as needed, but avoid leaking sensitive data by default.
  return {
    email: String(profileEffective?.email || "").trim().toLowerCase(),
    mode: profileEffective?.mode ?? null,
    rank_paygrade: profileEffective?.rank_paygrade ?? profileEffective?.rankPaygrade ?? profileEffective?.rank ?? null,
    rank: profileEffective?.rank ?? null,
    yos: toInt(profileEffective?.yos ?? profileEffective?.years_of_service ?? profileEffective?.yearsOfService),
    base: profileEffective?.base ?? profileEffective?.duty_station ?? profileEffective?.station ?? profileEffective?.pcs_base ?? null,
    family: profileEffective?.family ?? profileEffective?.family_size ?? profileEffective?.familySize ?? null,
    va_disability: profileEffective?.va_disability ?? profileEffective?.vaDisability ?? profileEffective?.va_rating ?? profileEffective?.vaRating ?? null,
    zip: profileEffective?.zip ?? profileEffective?.postal_code ?? null,
  };
}

// -----------------------------
// //#6 Netlify handler
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
        note: "POST JSON: { email, cityKey?, bedrooms?, price?, dpPct?, termYears?, creditScore?, apr?, taxRate?, insRate?, hoa?, pmiRate?, loanType?, overrides?, debug? }",
        paths: {
          payTables: "netlify/functions/data/militaryPayTables.json",
          citiesIndex: "netlify/functions/cities/bases.json",
        },
      });
    }

    if (event.httpMethod !== "POST") {
      return respond(event, 405, { ok: false, schemaVersion: SCHEMA_VERSION, error: "Method not allowed." });
    }

    const body = JSON.parse(event.body || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const debugOn = body?.debug === true;

    const cityKeyRaw = body.cityKey == null ? "" : String(body.cityKey);
    const cityKeyClean = safeKey(cityKeyRaw);
    const bedrooms = toInt(body.bedrooms) ?? 4;

    if (!email) return respond(event, 400, { ok: false, schemaVersion: SCHEMA_VERSION, error: "Missing email." });

    const payTables = loadPayTables();
    const profile = await fetchProfileByEmail(email);

    const { profileEffective, overridesApplied } = applyOverridesToProfile(profile, body.overrides);

    // Resolve cityKey: body.cityKey wins; else derive from base
    let resolvedCityKey = cityKeyClean || null;
    let cityResolve = { cityKey: null, source: "none", base: "" };

    if (!resolvedCityKey) {
      cityResolve = deriveCityKeyFromBase(profileEffective, payTables);
      resolvedCityKey = cityResolve.cityKey || "SanAntonio"; // last resort
    }

    // Load city from bases.json
    let city = null;
    let cityLoadError = null;

    try {
      city = loadCityFromBasesIndex({ profile: profileEffective, resolvedCityKey });
    } catch (err) {
      cityLoadError = String(err?.message || err);
      // Hard fallback attempt
      resolvedCityKey = "SanAntonio";
      city = loadCityFromBasesIndex({ profile: profileEffective, resolvedCityKey });
    }

    const computed = computePay(profileEffective, payTables);
    const mortgageCore = await computeMortgageEstimate({ body, profile: profileEffective, city, bedrooms });

    const mortgage = {
      ok: !!mortgageCore.ok,
      breakdown: mortgageCore.breakdown,
      assumptions: mortgageCore.assumptions,
      sources: mortgageCore.sources,

      totalMonthly: Number(mortgageCore?.breakdown?.totalMonthly || 0) || 0,
      principalInterestMonthly: Number(mortgageCore?.breakdown?.principalInterest || 0) || 0,
      taxMonthly: Number(mortgageCore?.breakdown?.propertyTax || 0) || 0,
      insuranceMonthly: Number(mortgageCore?.breakdown?.insurance || 0) || 0,
      hoaMonthly: Number(mortgageCore?.breakdown?.hoa || 0) || 0,
      pmiMonthly: Number(mortgageCore?.breakdown?.pmi || 0) || 0,

      aprUsed: Number(mortgageCore?.assumptions?.apr || 0) || 0,
      termYears: Number(mortgageCore?.assumptions?.termYears || 0) || 0,
      loanAmount: Number(mortgageCore?.assumptions?.loan || 0) || 0,

      source: "brain",
    };

    const publicProfile = buildPublicProfile(profileEffective);

    const needsProfile = {
      ok: (computed?.missing || []).length === 0,
      missing: computed?.missing || [],
      message:
        (computed?.missing || []).length === 0
          ? "Profile complete."
          : "Update your profile (rank/YOS/base/family/zip) to compute deterministic pay + city baselines.",
    };

    return respond(event, 200, {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      input: { email, cityKey: resolvedCityKey, bedrooms },

      // Contract-required fields
      profile: publicProfile,
      pay: computed.pay,
      city: city,
      missing: computed.missing,

      // Optional extras
      mortgage,
      estimatedMonthlyMortgage: mortgage.totalMonthly,
      needsProfile,

      // Debug only when requested
      debug: debugOn
        ? {
            payTablesPathUsed: __PAY_TABLES_PATH || null,
            basesIndexPathUsed: __BASES_INDEX_PATH || null,
            cityKeyRaw: cityKeyRaw || null,
            cityKeyResolved: resolvedCityKey,
            cityKeySource: cityKeyClean ? "body.cityKey" : (cityResolve.cityKey ? cityResolve.source : "default"),
            baseUsedForCity: cityResolve.base || null,
            cityLoadError: cityLoadError || null,
            overridesApplied: overridesApplied || [],
            basesIndexPick: city?.basesIndexPick || null,
            profileEffective: profileEffective, // ⚠️ includes private fields; only sent if debug=true
          }
        : undefined,
    });
  } catch (e) {
    return respond(event, 500, { ok: false, schemaVersion: SCHEMA_VERSION, error: String(e?.message || e) });
  }
}
