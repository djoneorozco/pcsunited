// netlify/functions/elena/skills/cities.js
// ============================================================
// PCSUnited • Elena Skill: CITIES — read city market JSON + answer “targets” questions
// Version: v1.0.0
//
// PURPOSE:
//  - Provide deterministic answers about a market (rent/home/utilities targets, by-bedroom ranges, etc.)
//  - Pulls from your existing city JSON files (authoritative):
//      ✅ netlify/functions/cities/*.json   (primary)
//  - NO duplicated math. NO OpenAI required.
//  - Designed to stay small even as you scale: add city JSON files, not code.
//
// EXPECTED CITY JSON SHAPE (flexible):
//  - Supports a few common structures, e.g.:
//      city.name / city.location
//      targets.rent, targets.home, targets.homePrice, targets.rent_by_bed, targets.home_by_bed
//      averages.utilities or utilities_by_bed
//      bedroom_costs / bedroomCosts / by_bedroom tables, etc.
//  - This skill does best-effort extraction with safe fallbacks.
//
// SKILL CONTRACT:
// module.exports = { id, priority, match, handle }
//
// ctx recommended shape:
// {
//   cityKey: "SanAntonio"  (optional),
//   base: "JBSA-Lackland"  (optional; if you have base->cityKey mapping elsewhere),
//   bedrooms: 3            (optional),
//   citiesDir: "netlify/functions/cities" (optional override)
// }
//
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");

/* ============================================================
   //#1 — Skill identity
============================================================ */
const SKILL_ID = "cities";
const PRIORITY = 70;

/* ============================================================
   //#2 — Helpers
============================================================ */
function safeStr(x) {
  const s = String(x ?? "").trim();
  return s || "";
}

function toInt(x) {
  const n = Number.parseInt(String(x), 10);
  return Number.isFinite(n) ? n : null;
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function money(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "$—";
  const isInt = Math.abs(x - Math.round(x)) < 0.000001;
  return x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: isInt ? 0 : 0,
    maximumFractionDigits: isInt ? 0 : 0,
  });
}

function clampBed(b) {
  const n = toInt(b);
  if (!n) return null;
  return Math.max(0, Math.min(10, n));
}

function normalizeKey(k) {
  return safeStr(k).replace(/[^a-z0-9]/gi, "");
}

function containsAny(haystack, needles) {
  const t = safeStr(haystack).toLowerCase();
  return needles.some((n) => t.includes(String(n).toLowerCase()));
}

/* ============================================================
   //#3 — Intent match
   Trigger on city/market/targets/rent/home price/utilities questions
============================================================ */
function match(text, ctx) {
  const t = safeStr(text).toLowerCase();
  if (!t) return false;

  // If router explicitly routes to this skill
  if (ctx?.forceSkill === SKILL_ID) return true;

  // Common triggers
  const triggers = [
    "city",
    "market",
    "targets",
    "target rent",
    "target home",
    "home price",
    "median home",
    "rent",
    "utilities",
    "what does san",
    "what does lackland",
    "cost of living",
    "bedroom",
    "3 bed",
    "4 bed",
  ];

  return containsAny(t, triggers);
}

/* ============================================================
   //#4 — City JSON loading
============================================================ */
function citiesDirFromCtx(ctx) {
  // Default: your canonical folder
  const fromCtx = safeStr(ctx?.citiesDir);
  if (fromCtx) return fromCtx;

  return path.join(process.cwd(), "netlify", "functions", "cities");
}

function listCityFiles(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .map((f) => path.join(dir, f));
  } catch (_) {
    return [];
  }
}

function loadCityByKey(dir, cityKey) {
  const key = safeStr(cityKey);
  if (!key) return { ok: false, reason: "Missing cityKey" };

  const fp = path.join(dir, `${key}.json`);
  if (!fs.existsSync(fp)) return { ok: false, reason: `City JSON not found: ${key}.json` };

  try {
    const raw = fs.readFileSync(fp, "utf8");
    const json = JSON.parse(raw);
    return { ok: true, cityKey: key, fp, json };
  } catch (err) {
    return { ok: false, reason: `Failed to read/parse ${key}.json: ${String(err)}` };
  }
}

/* ============================================================
   //#5 — CityKey resolution (best effort)
   Priority:
   1) ctx.cityKey
   2) payload.cityKey
   3) ctx.profile.cityKey (if you store it later)
   4) infer from text if user typed a known cityKey (filename match)
============================================================ */
function inferCityKeyFromText(dir, text) {
  const files = listCityFiles(dir);
  if (!files.length) return "";

  const t = safeStr(text).toLowerCase();
  if (!t) return "";

  // Compare normalized file base names against normalized text
  for (const fp of files) {
    const base = path.basename(fp, ".json"); // e.g., "SanAntonio"
    const bn = normalizeKey(base).toLowerCase();
    if (bn && normalizeKey(t).toLowerCase().includes(bn)) return base;
  }
  return "";
}

function resolveCityKey(dir, text, ctx, payload) {
  const c1 = safeStr(ctx?.cityKey);
  if (c1) return c1;

  const c2 = safeStr(payload?.cityKey);
  if (c2) return c2;

  const c3 = safeStr(ctx?.profile?.cityKey);
  if (c3) return c3;

  const inferred = inferCityKeyFromText(dir, text);
  if (inferred) return inferred;

  return "";
}

/* ============================================================
   //#6 — Extractors (flexible JSON shapes)
============================================================ */
function pick(obj, paths) {
  for (const p of paths) {
    try {
      const parts = p.split(".");
      let cur = obj;
      for (const part of parts) {
        if (cur == null) break;
        cur = cur[part];
      }
      if (cur !== undefined && cur !== null) return cur;
    } catch (_) {}
  }
  return null;
}

function extractName(cityJson, cityKey) {
  return (
    safeStr(pick(cityJson, ["name", "city.name", "meta.name", "location.name"])) ||
    safeStr(pick(cityJson, ["location", "city.location", "meta.location"])) ||
    safeStr(cityKey) ||
    "—"
  );
}

function extractTargets(cityJson) {
  // Common target locations
  const rent = toNum(
    pick(cityJson, [
      "targets.rent",
      "targets.target_rent",
      "targets.rent_target",
      "city.targets.rent",
      "city.targets.target_rent",
      "rent.target",
      "targetRent",
    ])
  );

  const home = toNum(
    pick(cityJson, [
      "targets.home",
      "targets.homePrice",
      "targets.target_home",
      "targets.target_home_price",
      "city.targets.home",
      "city.targets.homePrice",
      "home.target",
      "targetHome",
      "targetHomePrice",
    ])
  );

  // Optional: per-bedroom targets
  const rentByBed =
    pick(cityJson, ["targets.rent_by_bed", "targets.rentByBed", "rent_by_bed", "rentByBed", "bedroom_costs.rent"]) ||
    null;

  const homeByBed =
    pick(cityJson, ["targets.home_by_bed", "targets.homeByBed", "home_by_bed", "homeByBed", "bedroom_costs.home"]) ||
    null;

  // Utilities baseline (optional)
  const utilities =
    toNum(pick(cityJson, ["averages.utilities", "averages.avg_utilities", "utilities", "targets.utilities"])) || null;

  const utilitiesByBed =
    pick(cityJson, ["utilities_by_bed", "utilitiesByBed", "averages.utilities_by_bed", "bedroom_costs.utilities"]) ||
    null;

  return { rent, home, rentByBed, homeByBed, utilities, utilitiesByBed };
}

function extractByBedroomValue(table, bedrooms) {
  if (!table || typeof table !== "object") return null;
  const b = clampBed(bedrooms);
  if (b == null) return null;

  // Accept keys like "1","2","3" or 1,2,3
  const direct = table[String(b)];
  if (direct != null && typeof direct === "object") return direct;

  // Or table itself is numeric values by bed
  if (direct != null && (typeof direct === "number" || typeof direct === "string")) return toNum(direct);

  // Sometimes nested: { "3": { rent: 2200, home: 380000 } }
  // Already handled above.

  return null;
}

/* ============================================================
   //#7 — Response composer
============================================================ */
function buildCityReply({ cityName, cityKey, bedrooms, targets }) {
  const b = clampBed(bedrooms);
  const lines = [];

  lines.push(`Market snapshot: ${cityName}${cityKey ? ` (${cityKey})` : ""}`);

  // If user provided bedrooms and we have per-bedroom tables, use those first
  let rentForBed = null;
  let homeForBed = null;
  let utilForBed = null;

  if (b != null) {
    // rentByBed might be: { "3": 2200 } OR { "3": { rent: 2200 } }
    const rb = extractByBedroomValue(targets.rentByBed, b);
    const hb = extractByBedroomValue(targets.homeByBed, b);
    const ub = extractByBedroomValue(targets.utilitiesByBed, b);

    // If nested objects
    if (rb && typeof rb === "object") rentForBed = toNum(rb.rent ?? rb.target ?? rb.value);
    else rentForBed = toNum(rb);

    if (hb && typeof hb === "object") homeForBed = toNum(hb.home ?? hb.price ?? hb.target ?? hb.value);
    else homeForBed = toNum(hb);

    if (ub && typeof ub === "object") utilForBed = toNum(ub.utilities ?? ub.util ?? ub.value);
    else utilForBed = toNum(ub);
  }

  const rent = rentForBed ?? targets.rent;
  const home = homeForBed ?? targets.home;
  const util = utilForBed ?? targets.utilities;

  if (b != null) {
    lines.push(`For ${b} bedrooms (best available targets):`);
  } else {
    lines.push(`Targets (baseline):`);
  }

  if (rent != null && rent > 0) lines.push(`• Target rent: ${money(rent)}/mo`);
  else lines.push(`• Target rent: $— (not found in city JSON)`);

  if (home != null && home > 0) lines.push(`• Target home price: ${money(home)}`);
  else lines.push(`• Target home price: $— (not found in city JSON)`);

  if (util != null && util > 0) lines.push(`• Utilities baseline: ${money(util)}/mo`);
  // Utilities is optional; don't shame if missing

  // Light next prompt
  lines.push("");
  lines.push("If you tell me your rank + YOS + base (or email), I’ll connect this market to your actual pay and produce a clear affordability rail.");

  return lines.join("\n");
}

/* ============================================================
   //#8 — handle()
============================================================ */
async function handle(text, ctx) {
  const message = safeStr(text);

  // Payload might be passed in ctx.payload by your router pattern
  const payload = ctx?.payload && typeof ctx.payload === "object" ? ctx.payload : {};

  const dir = citiesDirFromCtx(ctx);
  const cityKey = resolveCityKey(dir, message, ctx, payload);

  if (!cityKey) {
    // Friendly deterministic fallback
    return {
      intent: "cities_missing_cityKey",
      reply:
        "Tell me the cityKey (example: “SanAntonio”) or the base/city name you want, and I’ll pull the market targets from our city JSONs.",
      data: {
        need: ["cityKey OR recognizable market name"],
        hint: { citiesDir: dir },
      },
      debug: { skill: SKILL_ID },
    };
  }

  const city = loadCityByKey(dir, cityKey);
  if (!city.ok) {
    return {
      intent: "cities_not_found",
      reply:
        `I tried to load ${cityKey}.json, but it wasn’t found. Double-check the file name in netlify/functions/cities/.`,
      data: { cityKey, citiesDir: dir },
      debug: { skill: SKILL_ID, reason: city.reason || "unknown" },
    };
  }

  const bedrooms =
    ctx?.bedrooms != null ? ctx.bedrooms : (payload?.bedrooms != null ? payload.bedrooms : null);

  const targets = extractTargets(city.json);
  const cityName = extractName(city.json, cityKey);

  const reply = buildCityReply({ cityName, cityKey, bedrooms, targets });

  return {
    intent: "cities_snapshot",
    reply,
    data: {
      cityKey,
      cityName,
      bedrooms: clampBed(bedrooms),
      targets: {
        rent: targets.rent ?? null,
        home: targets.home ?? null,
        utilities: targets.utilities ?? null,
        rentByBed: targets.rentByBed ?? null,
        homeByBed: targets.homeByBed ?? null,
        utilitiesByBed: targets.utilitiesByBed ?? null,
      },
      source: { file: city.fp },
    },
    debug: { skill: SKILL_ID, citiesDir: dir, file: city.fp },
  };
}

/* ============================================================
   //#9 — Export
============================================================ */
module.exports = {
  id: SKILL_ID,
  priority: PRIORITY,
  match,
  handle,
};
