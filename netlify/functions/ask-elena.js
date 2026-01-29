// netlify/functions/ask-elena.js
// v2.4.1 — PCSUnited Elena (Profile-aware + deterministic pay basics + affordability)
//
// GOAL:
// - Elena can answer questions about the user's profile + pay (Base Pay + BAS, and BAH if ZIP/base is available)
// - Adds deterministic “How much house can I afford?” quick answer
// - Uses deterministic pay tables from:
//     ✅ netlify/functions/data/militaryPayTables.json (recommended for PCSUnited)
//     ↩︎ netlify/functions/militaryPayTables.json (legacy fallback)
//
// ✅ UPDATE (MINIMAL, REQUESTED):
// - Also reads base/city JSON files from: netlify/functions/cities/*.json
// - Uses: netlify/functions/cities/index.byBase.json to map Base Name → { cityKey, file, zip }
// - Adds a deterministic “city/base data” responder for utilities / mortgage assumptions / demographics / market label & summary
// - Does NOT change any existing pay/profile/affordability logic paths beyond better ZIP resolution.
//
// REQUIRED ENV:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
// OPTIONAL ENV:
//   OPENAI_API_KEY   (only for non-deterministic questions)
//
// CLIENT SHOULD CALL (recommended):
//   POST https://pcsunited.netlify.app/api/ask-elena
//   body: { message, email, zip?, context?: { profile?: {...} } }

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

/* ============================================================
   //#1 — CORS (PCSUnited)
   - Remove OrozcoRealty domains to prevent cross-site “ghost” behavior.
   - Add PCSUnited origins you actually serve from.
============================================================ */
const ALLOW_ORIGINS = [
  "https://pcsunited.com",
  "https://www.pcsunited.com",
  "https://pcsunited.netlify.app",

  // If you still use Webflow staging for PCSUnited, keep these:
  // (replace with your real Webflow domains if different)
  "https://pcsunited.webflow.io",
  "https://www.pcsunited.webflow.io",

  "http://localhost:8888",
];

function corsHeaders(origin) {
  const o = String(origin || "").trim();
  const allow = ALLOW_ORIGINS.includes(o) ? o : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}

function respond(statusCode, headers, payload) {
  return { statusCode, headers, body: JSON.stringify(payload || {}) };
}

/* ============================================================
   //#2 — Supabase profile fields (minimal; compatible)
============================================================ */
const SELECT_COLS = [
  "id",
  "created_at",
  "profiles_user_id_unique",
  "email",
  "full_name",
  "last_name",
  "phone",
  "mode",
  "rank",
  "rank_paygrade",
  "va_disability",
  "yos",
  "family",
  "base",
  "notes",
].join(",");

/* ============================================================
   //#3 — Utility helpers
============================================================ */
function safeStr(x) {
  const s = String(x ?? "").trim();
  return s || "";
}

function normalizeEmail(x) {
  return safeStr(x).toLowerCase();
}

function lastNameOf(fullName, lastNameField) {
  const ln = safeStr(lastNameField);
  if (ln) return ln;

  const name = safeStr(fullName);
  if (!name) return "";
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function getEmailFromPayload(payload) {
  // Priority order: payload.email -> payload.context.email -> payload.context.profile.email -> payload.identity.email
  const direct = normalizeEmail(payload?.email);
  if (direct) return direct;

  const ctxEmail = normalizeEmail(payload?.context?.email);
  if (ctxEmail) return ctxEmail;

  const ctxProfEmail = normalizeEmail(payload?.context?.profile?.email);
  if (ctxProfEmail) return ctxProfEmail;

  const identEmail = normalizeEmail(payload?.identity?.email);
  if (identEmail) return identEmail;

  return "";
}

/**
 * Normalize paygrade to match your pay table keys:
 *  - "E7"  -> "E-7"
 *  - "E-7" -> "E-7"
 *  - "O1"  -> "O-1"
 */
function normalizePaygrade(x) {
  const raw = safeStr(x).toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (/^[EOW]-\d{1,2}$/.test(raw)) return raw;
  if (/^[EOW]\d{1,2}$/.test(raw)) return raw[0] + "-" + raw.slice(1);
  return raw; // fallback
}

function rankShort(paygradeOrRank) {
  const p = normalizePaygrade(paygradeOrRank);
  const map = {
    "E-1": "AB",
    "E-2": "Amn",
    "E-3": "A1C",
    "E-4": "SrA",
    "E-5": "SSgt",
    "E-6": "TSgt",
    "E-7": "MSgt",
    "E-8": "SMSgt",
    "E-9": "CMSgt",
    "W-1": "WO1",
    "W-2": "CWO2",
    "W-3": "CWO3",
    "W-4": "CWO4",
    "W-5": "CWO5",
    "O-1": "2nd Lt",
    "O-2": "1st Lt",
    "O-3": "Capt",
    "O-4": "Maj",
    "O-5": "Lt Col",
    "O-6": "Col",
    "O-7": "Brig Gen",
    "O-8": "Maj Gen",
    "O-9": "Lt Gen",
    "O-10": "Gen",
  };
  return map[p] || p || "";
}

function money(n) {
  const x = Number(n) || 0;
  return x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function normalizeBaseName(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/* ============================================================
   //#3B — Mortgage helpers (deterministic)
============================================================ */
function monthlyPaymentPI(principal, aprPercent, termYears) {
  const P = Number(principal) || 0;
  const apr = Number(aprPercent) || 0;
  const years = Number(termYears) || 30;
  const n = Math.max(1, Math.round(years * 12));

  if (P <= 0) return 0;

  const r = apr > 0 ? (apr / 100) / 12 : 0;
  if (r === 0) return P / n;

  const pow = Math.pow(1 + r, n);
  return (P * (r * pow)) / (pow - 1);
}

function principalFromPaymentPI(payment, aprPercent, termYears) {
  const M = Number(payment) || 0;
  const apr = Number(aprPercent) || 0;
  const years = Number(termYears) || 30;
  const n = Math.max(1, Math.round(years * 12));

  if (M <= 0) return 0;

  const r = apr > 0 ? (apr / 100) / 12 : 0;
  if (r === 0) return M * n;

  const pow = Math.pow(1 + r, n);
  // P = M * (( (1+r)^n - 1 ) / ( r*(1+r)^n ))
  return M * ((pow - 1) / (r * pow));
}

/* ============================================================
   //#4 — Deterministic pay tables (militaryPayTables.json)
   PCSUnited preferred location is /netlify/functions/data/
============================================================ */
let __PAY_TABLES_CACHE__ = null;
let __PAY_TABLES_LOC_USED__ = null; // "data" | "legacy" | null

function loadPayTables() {
  if (__PAY_TABLES_CACHE__ !== null) return __PAY_TABLES_CACHE__;

  // ✅ PCSUnited preferred
  const pData = path.join(process.cwd(), "netlify", "functions", "data", "militaryPayTables.json");
  // ↩︎ legacy fallback
  const pLegacy = path.join(process.cwd(), "netlify", "functions", "militaryPayTables.json");

  try {
    let fp = null;
    if (fs.existsSync(pData)) {
      fp = pData;
      __PAY_TABLES_LOC_USED__ = "data";
    } else if (fs.existsSync(pLegacy)) {
      fp = pLegacy;
      __PAY_TABLES_LOC_USED__ = "legacy";
    }

    if (!fp) {
      __PAY_TABLES_CACHE__ = null;
      __PAY_TABLES_LOC_USED__ = null;
      return null;
    }

    const raw = fs.readFileSync(fp, "utf8");
    __PAY_TABLES_CACHE__ = JSON.parse(raw);
    return __PAY_TABLES_CACHE__;
  } catch (_) {
    __PAY_TABLES_CACHE__ = null;
    __PAY_TABLES_LOC_USED__ = null;
    return null;
  }
}

// choose nearest YOS key <= requested YOS if exact missing
function pickYosValue(tableForRank, yos) {
  if (!tableForRank || typeof tableForRank !== "object") return 0;

  const y = Number(yos);
  if (!Number.isFinite(y)) return 0;

  const direct = tableForRank[String(y)];
  if (direct != null) return Number(direct) || 0;

  const keys = Object.keys(tableForRank)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (!keys.length) return 0;

  let best = keys[0];
  for (const k of keys) {
    if (k <= y) best = k;
    else break;
  }
  return Number(tableForRank[String(best)]) || 0;
}

function deriveZipFromBase(tables, baseName) {
  const baseToZip = tables?.BAH?.base_to_zip || tables?.BAH?.baseToZip || {};
  if (!baseName) return "";

  const want = normalizeBaseName(baseName);
  if (!want) return "";

  const map = new Map();
  for (const [k, v] of Object.entries(baseToZip || {})) {
    const nk = normalizeBaseName(k);
    if (nk) map.set(nk, safeStr(v));
  }

  return map.get(want) || "";
}

function lookupBah(tables, zip, paygrade, familyBool) {
  const z = safeStr(zip);
  if (!z) return { bah: 0, note: "BAH needs a ZIP code (or a base name for base→ZIP mapping)." };

  const rec =
    tables?.BAH?.by_zip?.[z] ||
    tables?.BAH?.byZip?.[z] ||
    tables?.BAH_TX?.[z] ||
    null;

  if (!rec) return { bah: 0, note: "BAH ZIP not found in table." };

  const bucket = familyBool ? rec.with : rec.without;
  const val = Number(bucket?.[paygrade]) || 0;

  if (!val) return { bah: 0, note: "BAH for that ZIP/paygrade not found." };
  return { bah: val, note: "" };
}

function computePayBasics({ paygrade, yos, zip, family, base }) {
  const tables = loadPayTables();
  if (!tables) return { ok: false, reason: "Pay tables JSON not available on server." };

  const pg = normalizePaygrade(paygrade);
  const y = Number(yos);

  if (!pg || !Number.isFinite(y)) {
    return { ok: false, reason: "Missing rank/paygrade or YOS." };
  }

  const baseTable = tables.BASEPAY?.[pg];
  const basePay = pickYosValue(baseTable, y);

  const isOfficer = pg.startsWith("O-") || pg.startsWith("W-");
  const bas = Number(isOfficer ? tables.BAS?.officer : tables.BAS?.enlisted) || 0;

  let z = safeStr(zip);
  if (!z) {
    const derived = deriveZipFromBase(tables, base);
    if (derived) z = derived;
  }

  const { bah, note: bahNote } = lookupBah(tables, z, pg, !!family);

  return {
    ok: true,
    basePay,
    bas,
    bah,
    total: basePay + bas + bah,
    bahNote: bahNote || "",
    resolvedZip: z || "",
  };
}

/* ============================================================
   //#4B — Base → City files (netlify/functions/cities)
   Uses index.byBase.json:
   {
     "version":"1.0",
     "bases": {
       "JBSA-Lackland": { "cityKey":"SanAntonio", "file":"Lackland", "zip":"78236" },
       ...
     }
   }
============================================================ */
let __CITY_INDEX_CACHE__ = null;
let __CITY_INDEX_LOADED__ = false;
let __CITY_INDEX_FP__ = null;

let __CITY_FILE_CACHE__ = new Map(); // key: file (e.g., "Lackland") -> json
let __CITY_FILE_LAST__ = null;       // last loaded file name (for debug)
let __CITY_FILE_FP_LAST__ = null;    // last loaded full path (for debug)

function loadBaseIndex() {
  if (__CITY_INDEX_LOADED__) return __CITY_INDEX_CACHE__;

  const fp = path.join(process.cwd(), "netlify", "functions", "cities", "index.byBase.json");
  __CITY_INDEX_FP__ = fp;

  try {
    if (!fs.existsSync(fp)) {
      __CITY_INDEX_CACHE__ = null;
      __CITY_INDEX_LOADED__ = true;
      return null;
    }
    const raw = fs.readFileSync(fp, "utf8");
    __CITY_INDEX_CACHE__ = JSON.parse(raw);
    __CITY_INDEX_LOADED__ = true;
    return __CITY_INDEX_CACHE__;
  } catch (_) {
    __CITY_INDEX_CACHE__ = null;
    __CITY_INDEX_LOADED__ = true;
    return null;
  }
}

function resolveBaseEntry(baseName, indexJson) {
  const b = safeStr(baseName);
  if (!b || !indexJson || typeof indexJson !== "object") return null;

  const bases = indexJson.bases && typeof indexJson.bases === "object" ? indexJson.bases : null;
  if (!bases) return null;

  // 1) Exact key match first (your index keys are already human-readable)
  if (bases[b]) return bases[b];

  // 2) Normalize compare
  const want = normalizeBaseName(b);
  if (!want) return null;

  const normMap = new Map();
  for (const [k, v] of Object.entries(bases)) {
    const nk = normalizeBaseName(k);
    if (nk) normMap.set(nk, v);
  }

  return normMap.get(want) || null;
}

function loadCityJsonByFile(fileName) {
  const f = safeStr(fileName);
  if (!f) return null;

  if (__CITY_FILE_CACHE__.has(f)) return __CITY_FILE_CACHE__.get(f);

  const fp = path.join(process.cwd(), "netlify", "functions", "cities", `${f}.json`);
  __CITY_FILE_LAST__ = f;
  __CITY_FILE_FP_LAST__ = fp;

  try {
    if (!fs.existsSync(fp)) {
      __CITY_FILE_CACHE__.set(f, null);
      return null;
    }
    const raw = fs.readFileSync(fp, "utf8");
    const json = JSON.parse(raw);
    __CITY_FILE_CACHE__.set(f, json);
    return json;
  } catch (_) {
    __CITY_FILE_CACHE__.set(f, null);
    return null;
  }
}

function parseBedroomCount(text) {
  const t = String(text || "");
  const m = t.match(/(\d+)\s*[- ]?\s*bed(room)?/i);
  const n = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return String(n);
}

function pickCityLite(cityJson) {
  if (!cityJson || typeof cityJson !== "object") return null;

  // Keep payload modest; enough for LLM + deterministic city answers
  const market = cityJson?.housing?.market || cityJson?.housing?.market || {};
  const lite = {
    city: safeStr(cityJson.city) || null,
    place: safeStr(cityJson.place) || null,
    state: safeStr(cityJson.state) || null,
    zip: safeStr(cityJson.zip) || null,
    year: cityJson.year ?? null,
    last_updated_data_from_sources: safeStr(cityJson.last_updated_data_from_sources) || null,
    market_label: safeStr(cityJson.market_label) || null,
    avg_home_value: Number(cityJson.avg_home_value ?? cityJson.average_home_value ?? cityJson.avgHome ?? cityJson.city_avg_home ?? 0) || 0,
    mortgage_assumptions: cityJson.mortgage_assumptions || null,
    property_tax_rate: cityJson.property_tax_rate ?? null,
    insurance_rate: cityJson.insurance_rate ?? null,
    hoa_monthly: cityJson.hoa_monthly ?? null,
    income: cityJson.income || null,
    population: cityJson.population || null,
    veterans: cityJson.veterans || null,
    by_bedroom: cityJson.by_bedroom || null,
    market: {
      market_type_summary: safeStr(market.market_type_summary) || null,
      average_days_on_market: market.average_days_on_market ?? null,
      active_listings_total: market.active_listings_total ?? null,
      median_listing_price_realtor: market.median_listing_price_realtor ?? null,
      median_sale_price_current: market.median_sale_price_current ?? null,
      median_listing_price_per_sqft: market.median_listing_price_per_sqft ?? null,
      zillow_one_year_change_percent: market.zillow_one_year_change_percent ?? null,
    },
  };

  return lite;
}

function answerCityQuestion(userText, baseName, baseEntry, cityLite) {
  const t = String(userText || "").toLowerCase();
  if (!cityLite) {
    const b = safeStr(baseName) || (safeStr(baseEntry?.file) ? safeStr(baseEntry.file) : "your base");
    return {
      ok: false,
      reply:
        `I’m not seeing a loaded city file for ${b} yet. That usually means the base→file mapping didn’t resolve, or the JSON file isn’t included in the function bundle.`,
    };
  }

  const cityName = cityLite.place || cityLite.city || "this city";
  const marketLabel = cityLite.market_label || "—";

  // Market label / ZIP / basic profile
  if (t.includes("market label") || t.includes("market_label") || t.includes("marketlabel") || t.includes("marketlabel")) {
    return {
      ok: true,
      reply: `For ${safeStr(baseName) || "this base"}, I have ZIP ${safeStr(baseEntry?.zip || cityLite.zip || "—")} and market label “${marketLabel}”.`,
    };
  }

  if (t.includes("zip")) {
    return {
      ok: true,
      reply: `ZIP on file for ${safeStr(baseName) || "this base"} is ${safeStr(baseEntry?.zip || cityLite.zip || "—")}.`,
    };
  }

  // Mortgage assumptions
  if (
    t.includes("mortgage assumptions") ||
    (t.includes("assumptions") && (t.includes("apr") || t.includes("term") || t.includes("down")))
  ) {
    const ma = cityLite.mortgage_assumptions || {};
    const apr = ma.apr_percent ?? null;
    const term = ma.term_years ?? null;
    const down = ma.down_payment_percent ?? null;
    const includes = safeStr(ma.includes) || null;

    if (apr == null && term == null && down == null) {
      return { ok: false, reply: `I’m not seeing mortgage_assumptions in the city file for ${cityName}.` };
    }

    return {
      ok: true,
      reply: `City mortgage assumptions for ${cityName}: APR ${apr ?? "—"}%, term ${term ?? "—"} years, down payment ${down ?? "—"}%${includes ? `, includes: ${includes}` : ""}.`,
    };
  }

  // Income / poverty
  if (t.includes("median household income") || t.includes("poverty")) {
    const inc = cityLite.income || {};
    const med = inc.median_household_income ?? null;
    const pov = inc.poverty_rate_percent ?? null;

    if (med == null && pov == null) {
      return { ok: false, reply: `I’m not seeing income/poverty fields in the city file for ${cityName}.` };
    }

    return {
      ok: true,
      reply: `City profile for ${cityName}: median household income ${med ? money(med) : "—"}; poverty rate ${pov != null ? `${pov}%` : "—"}.`,
    };
  }

  // Utilities by bedroom
  if (t.includes("utilities") || t.includes("utility")) {
    const bed = parseBedroomCount(userText);
    const by = cityLite.by_bedroom || {};
    const node = bed && by ? by[bed] : null;
    const util = node?.utilities || null;

    if (!bed) {
      return {
        ok: true,
        reply: `Tell me the bedroom count (e.g., “3-bedroom utilities”), and I’ll pull the exact low/high/avg from the city file for ${cityName}.`,
      };
    }

    if (!util || typeof util !== "object") {
      return { ok: false, reply: `I’m not seeing utilities for ${bed}-bedroom in the city file for ${cityName}.` };
    }

    const eg = util.electric_gas || {};
    const ws = util.water_sewer || {};
    const tot = util.total || {};
    const asOf = safeStr(util.as_of) || "—";

    return {
      ok: true,
      reply: [
        `${cityName} • ${bed}-bed utilities (as of ${asOf}):`,
        `• Electric/Gas: ${money(eg.low)}–${money(eg.high)} (avg ${money(eg.avg)})`,
        `• Water/Sewer: ${money(ws.low)}–${money(ws.high)} (avg ${money(ws.avg)})`,
        `• Total: ${money(tot.low)}–${money(tot.high)} (avg ${money(tot.avg)})`,
      ].join("\n"),
    };
  }

  // Market type summary
  if (t.includes("market_type_summary") || (t.includes("market") && t.includes("summary"))) {
    const s = safeStr(cityLite.market?.market_type_summary);
    if (!s) return { ok: false, reply: `I’m not seeing market_type_summary in the city file for ${cityName}.` };
    return { ok: true, reply: `Market type summary for ${cityName}: ${s}` };
  }

  // Avg home value
  if (t.includes("avg home value") || t.includes("average home value") || t.includes("avg_home_value")) {
    const v = Number(cityLite.avg_home_value) || 0;
    if (!v) return { ok: false, reply: `I’m not seeing avg_home_value in the city file for ${cityName}.` };
    return { ok: true, reply: `Average home value in ${cityName}: ${money(v)}.` };
  }

  // Generic city profile poke
  return {
    ok: true,
    reply: `I have the city file loaded for ${cityName} (market “${marketLabel}”). Ask me utilities by bedroom, mortgage assumptions, income/poverty, market summary, or avg home value.`,
  };
}

/* ============================================================
   //#5 — Intent detection (simple + reliable)
============================================================ */
function detectIntent(text) {
  const t = String(text || "").toLowerCase();

  if (
    t.includes("monthly pay") ||
    t.includes("total pay") ||
    t.includes("how much do i make") ||
    t.includes("salary") ||
    (t.includes("pay") && (t.includes("monthly") || t.includes("total") || t.includes("mine") || t.includes("my")))
  ) return { type: "pay_question" };

  if (t.includes("my rank") || (t.includes("rank") && t.includes("my")) || t.includes("profile loaded")) {
    return { type: "profile_question" };
  }

  if (
    t.includes("afford") ||
    t.includes("how much house") ||
    t.includes("how much home") ||
    t.includes("most i can spend") ||
    (t.includes("spend") && (t.includes("house") || t.includes("home"))) ||
    (t.includes("budget") && (t.includes("house") || t.includes("home") || t.includes("mortgage")))
  ) return { type: "affordability_question" };

  // ✅ City/base JSON questions (minimal add so Elena uses cities/*.json)
  if (
    t.includes("utilities") ||
    t.includes("utility") ||
    t.includes("market label") ||
    t.includes("market_label") ||
    t.includes("market_type_summary") ||
    (t.includes("market") && t.includes("summary")) ||
    t.includes("mortgage assumptions") ||
    (t.includes("assumptions") && (t.includes("apr") || t.includes("term") || t.includes("down"))) ||
    t.includes("median household income") ||
    t.includes("poverty") ||
    t.includes("avg home value") ||
    t.includes("average home value") ||
    t.includes("avg_home_value") ||
    (t.includes("what zip") && t.includes("base")) ||
    (t.includes("zip") && t.includes("market"))
  ) return { type: "city_question" };

  return null;
}

/* ============================================================
   //#6 — Main handler
============================================================ */
module.exports.handler = async (event) => {
  const origin = event.headers?.origin || "";
  const headers = corsHeaders(origin);

  if (event.httpMethod === "OPTIONS") return respond(204, headers, {});
  if (event.httpMethod !== "POST") return respond(405, headers, { error: "Method Not Allowed" });

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_) {
    return respond(400, headers, { error: "Invalid JSON body" });
  }

  const userText = safeStr(payload.message);
  if (!userText) return respond(400, headers, { error: "Missing message" });

  const contextProfile =
    payload?.context?.profile && typeof payload.context.profile === "object"
      ? payload.context.profile
      : null;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const email = getEmailFromPayload(payload);
  let profile = null;
  let usedSupabase = false;

  if (email && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data, error } = await supabase
        .from("profiles")
        .select(SELECT_COLS)
        .eq("email", email)
        .maybeSingle();

      if (!error && data) {
        profile = data;
        usedSupabase = true;
      }
    } catch (_) {
      // swallow — we can still respond using contextProfile
    }
  }

  if (!profile && contextProfile) profile = contextProfile;

  const fullName = safeStr(profile?.full_name);
  const ln = lastNameOf(fullName, profile?.last_name);
  const pg = normalizePaygrade(profile?.rank_paygrade || profile?.rank);
  const yos = profile?.yos ?? null;
  const base = safeStr(profile?.base);
  const family = profile?.family ?? null;
  const va = profile?.va_disability ?? null;

  const zip = safeStr(payload.zip || payload?.context?.zip || "");

  const profileContext = profile
    ? {
        email: normalizeEmail(profile.email || email) || null,
        full_name: fullName || null,
        last_name: safeStr(profile.last_name) || null,
        rank_paygrade: safeStr(profile.rank_paygrade) || null,
        rank: safeStr(profile.rank) || null,
        yos: yos === null || yos === undefined ? null : Number(yos),
        base: base || null,
        family: family === null || family === undefined ? null : family,
        va_disability: va === null || va === undefined ? null : va,
        mode: safeStr(profile.mode) || null,
      }
    : null;

  const intent = detectIntent(userText);

  // ============================================================
  // //#6.0 — Load base→city mapping + city JSON (if possible)
  // ============================================================
  const baseIndex = loadBaseIndex();
  const baseEntry = resolveBaseEntry(base, baseIndex);
  const cityJson = baseEntry?.file ? loadCityJsonByFile(baseEntry.file) : null;
  const cityLite = pickCityLite(cityJson);

  // Resolve ZIP early (used for deterministic + OpenAI fallback)
  const tables = loadPayTables();
  const derivedZipFromPayTables = !zip && base && tables ? deriveZipFromBase(tables, base) : "";
  const derivedZipFromBaseIndex = safeStr(baseEntry?.zip || "");
  const resolvedZip = zip || derivedZipFromPayTables || derivedZipFromBaseIndex || "";

  // ============================================================
  // //#6.1 — Profile question (deterministic)
  // ============================================================
  if (intent?.type === "profile_question") {
    if (!profileContext || !profileContext.email) {
      return respond(200, headers, {
        intent: "profile_question",
        reply:
          "I can answer that instantly once your profile is synced. Send your email (or load your profile in the shell) and I’ll pull your rank + YOS.",
        profile: null,
        debug: {
          usedSupabase,
          hasContextProfile: !!contextProfile,
          payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
          baseIndexPath: __CITY_INDEX_FP__ || null,
          baseEntry: baseEntry || null,
          cityFile: baseEntry?.file ? `${baseEntry.file}.json` : null,
          cityLoaded: !!cityLite,
        },
      });
    }

    const r = rankShort(pg) || pg || "—";
    const y = profileContext.yos !== null && profileContext.yos !== undefined ? String(profileContext.yos) : "—";
    const fam = profileContext.family !== null && profileContext.family !== undefined ? String(profileContext.family) : "—";
    const vaTxt =
      profileContext.va_disability !== null && profileContext.va_disability !== undefined
        ? `${profileContext.va_disability}%`
        : "—";

    return respond(200, headers, {
      intent: "profile_question",
      reply: `Locked in. I see you as ${r} ${ln || ""} — ${y} YOS, Base ${base || "—"}, Family ${fam}, VA ${vaTxt}.`.trim(),
      profile: profileContext,
      city: cityLite || undefined,
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
        resolvedZip: resolvedZip || null,
        baseIndexPath: __CITY_INDEX_FP__ || null,
        baseEntry: baseEntry || null,
        cityFile: baseEntry?.file ? `${baseEntry.file}.json` : null,
        cityLoaded: !!cityLite,
        cityFilePath: __CITY_FILE_FP_LAST__ || null,
      },
    });
  }

  // ============================================================
  // //#6.2 — Pay question (deterministic)
  // ============================================================
  if (intent?.type === "pay_question") {
    if (!profileContext || !profileContext.email) {
      return respond(200, headers, {
        intent: "pay_question",
        reply:
          "I can calculate that instantly once your profile is synced. Send your email (or load your profile in the shell) so I can grab rank + YOS.",
        profile: null,
        debug: {
          usedSupabase,
          hasContextProfile: !!contextProfile,
          payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
          baseIndexPath: __CITY_INDEX_FP__ || null,
          baseEntry: baseEntry || null,
          cityFile: baseEntry?.file ? `${baseEntry.file}.json` : null,
          cityLoaded: !!cityLite,
        },
      });
    }

    const pay = computePayBasics({
      paygrade: pg,
      yos: profileContext.yos,
      zip: resolvedZip,
      family: !!profileContext.family,
      base: profileContext.base,
    });

    const r = rankShort(pg) || pg || "—";

    if (!pay.ok) {
      return respond(200, headers, {
        intent: "pay_question",
        reply: `I can see your profile (${r}, ${String(profileContext.yos ?? "—")} YOS), but pay math can’t run yet: ${pay.reason}`,
        profile: profileContext,
        city: cityLite || undefined,
        debug: {
          usedSupabase,
          hasContextProfile: !!contextProfile,
          payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
          resolvedZip: resolvedZip || null,
          baseIndexPath: __CITY_INDEX_FP__ || null,
          baseEntry: baseEntry || null,
          cityFile: baseEntry?.file ? `${baseEntry.file}.json` : null,
          cityLoaded: !!cityLite,
        },
      });
    }

    const lines = [];
    lines.push(`Monthly pay snapshot for ${r} ${ln || ""}:`.trim());
    lines.push(`• Base Pay: ${money(pay.basePay)}`);
    lines.push(`• BAS: ${money(pay.bas)}`);

    if (pay.bah > 0) {
      lines.push(`• BAH: ${money(pay.bah)}${pay.resolvedZip ? ` (ZIP ${pay.resolvedZip})` : ""}`);
    } else {
      lines.push(`• BAH: — (${pay.bahNote || "ZIP required"})`);
    }

    lines.push(`= Estimated Total: ${money(pay.total)} / month`);

    return respond(200, headers, {
      intent: "pay_question",
      reply: lines.join("\n"),
      profile: profileContext,
      city: cityLite || undefined,
      pay: {
        basePay: pay.basePay,
        bas: pay.bas,
        bah: pay.bah,
        total: pay.total,
        bahNote: pay.bahNote || "",
        resolvedZip: pay.resolvedZip || "",
        inputs: {
          paygrade: pg || null,
          yos: profileContext.yos ?? null,
          zip: resolvedZip || null,
          base: profileContext.base || null,
          family: !!profileContext.family,
        },
      },
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
        resolvedZip: resolvedZip || null,
        baseIndexPath: __CITY_INDEX_FP__ || null,
        baseEntry: baseEntry || null,
        cityFile: baseEntry?.file ? `${baseEntry.file}.json` : null,
        cityLoaded: !!cityLite,
      },
    });
  }

  // ============================================================
  // //#6.2B — City/Base question (deterministic from cities/*.json)
  // ============================================================
  if (intent?.type === "city_question") {
    const ans = answerCityQuestion(userText, base, baseEntry, cityLite);

    return respond(200, headers, {
      intent: "city_question",
      reply: ans.reply,
      profile: profileContext || null,
      city: cityLite || null,
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
        resolvedZip: resolvedZip || null,
        baseIndexPath: __CITY_INDEX_FP__ || null,
        baseEntry: baseEntry || null,
        cityFile: baseEntry?.file ? `${baseEntry.file}.json` : null,
        cityLoaded: !!cityLite,
        cityFilePath: __CITY_FILE_FP_LAST__ || null,
      },
    });
  }

  // ============================================================
  // //#6.3 — Affordability question (deterministic quick answer)
  // ============================================================
  if (intent?.type === "affordability_question") {
    if (!profileContext || !profileContext.email) {
      return respond(200, headers, {
        intent: "affordability_question",
        reply:
          "I can calculate that fast — I just need your profile synced (email) so I can pull rank + YOS + base for BAH.",
        profile: null,
        debug: {
          usedSupabase,
          hasContextProfile: !!contextProfile,
          payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
          baseIndexPath: __CITY_INDEX_FP__ || null,
          baseEntry: baseEntry || null,
          cityFile: baseEntry?.file ? `${baseEntry.file}.json` : null,
          cityLoaded: !!cityLite,
        },
      });
    }

    const r = rankShort(pg) || pg || "—";

    const pay = computePayBasics({
      paygrade: pg,
      yos: profileContext.yos,
      zip: resolvedZip,
      family: !!profileContext.family,
      base: profileContext.base,
    });

    if (!pay.ok) {
      return respond(200, headers, {
        intent: "affordability_question",
        reply: `I can see your profile (${r}, ${String(profileContext.yos ?? "—")} YOS), but pay math can’t run yet: ${pay.reason}`,
        profile: profileContext,
        city: cityLite || undefined,
        debug: {
          usedSupabase,
          hasContextProfile: !!contextProfile,
          payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
          resolvedZip: resolvedZip || null,
          baseIndexPath: __CITY_INDEX_FP__ || null,
          baseEntry: baseEntry || null,
          cityFile: baseEntry?.file ? `${baseEntry.file}.json` : null,
          cityLoaded: !!cityLite,
        },
      });
    }

    const totalPay = Number(pay.total) || 0;
    const allInCap = totalPay * 0.30; // safe all-in housing cap
    const piTarget = allInCap / 1.28; // buffer for taxes/ins/HOA

    // Explicit quick assumptions (same as your original)
    const aprAssumed = 7.0;
    const termAssumed = 30;

    const maxPrincipal = principalFromPaymentPI(piTarget, aprAssumed, termAssumed);

    const price0 = maxPrincipal; // 0% down estimate
    const price5 = maxPrincipal / (1 - 0.05);

    const lines = [];
    lines.push(`BLUF: Your “safe” all-in housing cap is about ${money(allInCap)}/mo.`);
    lines.push(`That’s a P&I target of ~${money(piTarget)}/mo (using your 1.28 buffer).`);
    lines.push("");
    lines.push(`Pay snapshot for ${r} ${ln || ""}:`.trim());
    lines.push(`• Base Pay: ${money(pay.basePay)}`);
    lines.push(`• BAS: ${money(pay.bas)}`);
    if (pay.bah > 0) lines.push(`• BAH: ${money(pay.bah)}${pay.resolvedZip ? ` (ZIP ${pay.resolvedZip})` : ""}`);
    else lines.push(`• BAH: — (${pay.bahNote || "needs base/ZIP"})`);
    lines.push(`= Total Pay Used: ${money(totalPay)}/mo`);
    lines.push("");
    lines.push(`Quick max price estimate (assumes ${aprAssumed}% APR, ${termAssumed}yr fixed):`);
    lines.push(`• ~${money(price0)} home price @ 0% down (VA-style rough cap)`);
    lines.push(`• ~${money(price5)} home price @ 5% down`);
    lines.push("");
    lines.push(`If you tell me your credit score + planned down payment, I’ll tighten this to your real APR band.`);

    return respond(200, headers, {
      intent: "affordability_question",
      reply: lines.join("\n"),
      profile: profileContext,
      city: cityLite || undefined,
      pay: {
        basePay: pay.basePay,
        bas: pay.bas,
        bah: pay.bah,
        total: pay.total,
        resolvedZip: pay.resolvedZip || "",
      },
      affordability: {
        ratios: { housing_cap_pct: 0.30, buffer_allin_to_pi: 1.28 },
        allInCapMonthly: allInCap,
        piTargetMonthly: piTarget,
        assumptions: { apr_percent: aprAssumed, term_years: termAssumed },
        maxPrincipal,
        maxPrice_0_down: price0,
        maxPrice_5_down: price5,
      },
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
        resolvedZip: resolvedZip || null,
        baseIndexPath: __CITY_INDEX_FP__ || null,
        baseEntry: baseEntry || null,
        cityFile: baseEntry?.file ? `${baseEntry.file}.json` : null,
        cityLoaded: !!cityLite,
      },
    });
  }

  // ============================================================
  // //#6.4 — OpenAI fallback (profile-aware, optional)
  // ============================================================
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const hint = profileContext
      ? `I can see your profile (${rankShort(pg) || pg || "—"}, ${String(profileContext.yos ?? "—")} YOS, ${base || "—"}).`
      : "I can’t see your profile yet (sync it in the shell or include email).";

    return respond(200, headers, {
      intent: "fallback_no_openai",
      reply: `Elena (dev echo): “${userText}” — ${hint} Add OPENAI_API_KEY for natural-language answers.`,
      profile: profileContext,
      city: cityLite || undefined,
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
        resolvedZip: resolvedZip || null,
        baseIndexPath: __CITY_INDEX_FP__ || null,
        baseEntry: baseEntry || null,
        cityFile: baseEntry?.file ? `${baseEntry.file}.json` : null,
        cityLoaded: !!cityLite,
      },
    });
  }

  // Provide pay preview to the LLM so it DOESN’T ask for ZIP if base already gives one.
  let payPreview = null;
  if (profileContext && pg && profileContext.yos !== null && profileContext.yos !== undefined) {
    const p = computePayBasics({
      paygrade: pg,
      yos: profileContext.yos,
      zip: resolvedZip,
      family: !!profileContext.family,
      base: profileContext.base,
    });
    if (p?.ok) payPreview = p;
  }

  const system = [
    "You are Elena, a warm, high-trust A.I. Concierge for PCSUnited / RealtySaSS.",
    "BLUF-first. Keep answers under 8 sentences. No fluff.",
    "If a question needs math, ask for the missing inputs explicitly.",
    "If profile is available, use it (rank/yos/base/family/VA).",
    "IMPORTANT: If resolvedZip is provided (either user ZIP or derived from base), DO NOT ask for ZIP.",
    "If payPreview is provided, you can reference Base Pay + BAS + BAH + Total directly.",
    "If city data is provided, use it as source-of-truth for utilities, mortgage assumptions, demographics, and market summary.",
  ].join(" ");

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.35,
        max_tokens: 450,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({
              message: userText,
              profile: profileContext,
              resolvedZip: resolvedZip || null,
              baseEntry: baseEntry || null,
              city: cityLite || null,
              payPreview: payPreview
                ? {
                    basePay: payPreview.basePay,
                    bas: payPreview.bas,
                    bah: payPreview.bah,
                    total: payPreview.total,
                    bahNote: payPreview.bahNote,
                  }
                : null,
              note: "Use city/base data if present. Use resolvedZip/payPreview if present. Only ask for missing inputs once.",
            }),
          },
        ],
      }),
    });

    const data = await resp.json();
    const reply = (data?.choices?.[0]?.message?.content || "").trim() || "I’m here — what are we solving today?";

    return respond(200, headers, {
      intent: "openai_fallback",
      reply,
      profile: profileContext || undefined,
      city: cityLite || undefined,
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
        resolvedZip: resolvedZip || null,
        baseIndexPath: __CITY_INDEX_FP__ || null,
        baseEntry: baseEntry || null,
        cityFile: baseEntry?.file ? `${baseEntry.file}.json` : null,
        cityLoaded: !!cityLite,
        cityFilePath: __CITY_FILE_FP_LAST__ || null,
      },
    });
  } catch (err) {
    return respond(500, headers, {
      error: "Server exception",
      detail: String(err),
      debug: {
        usedSupabase,
        hasContextProfile: !!contextProfile,
        payTablesLocation: __PAY_TABLES_LOC_USED__ || null,
        baseIndexPath: __CITY_INDEX_FP__ || null,
        baseEntry: baseEntry || null,
        cityFile: baseEntry?.file ? `${baseEntry.file}.json` : null,
        cityLoaded: !!cityLite,
        cityFilePath: __CITY_FILE_FP_LAST__ || null,
      },
    });
  }
};
