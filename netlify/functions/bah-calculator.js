// netlify/functions/bah-calculator.js
// ============================================================
// PCSUnited • BAH Calculator
// v1.0.0
//
// PURPOSE
// - Lightweight endpoint for Webflow / PCSUnited BAH Calculator
// - Computes Base Pay + BAH + BAS + Total Monthly Military Pay
// - Uses militaryPayTables.json as source of truth
// - Supports base -> zip via BAH.base_to_zip
// - CORS-safe for Webflow previews
//
// POST BODY
// {
//   "rank": "E-5",
//   "yos": 6,
//   "base": "JBSA-Lackland",
//   "family": true
// }
//
// RESPONSE
// {
//   ok: true,
//   rank: "E-5",
//   rankTitle: "Staff Sergeant",
//   yos: 6,
//   base: "JBSA-Lackland",
//   zip: "78236",
//   family: true,
//   basePay: 3946.8,
//   bah: 1935,
//   bas: 476.95,
//   total: 6358.75,
//   locationLabel: "SAN ANTONIO, TX"
// }
// ============================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");

/* ============================================================
  //#1) CORS
============================================================ */
const ALLOWED_ORIGINS = new Set([
  "https://pcsunited.com",
  "https://www.pcsunited.com",
  "https://pcs-united.webflow.io",
  "https://pcsu.webflow.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8888",
  "http://127.0.0.1:8888"
]);

function buildCorsHeaders(event) {
  const origin =
    event?.headers?.origin ||
    event?.headers?.Origin ||
    "";

  const allowOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://pcsunited.com";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json"
  };
}

function respond(event, statusCode, obj) {
  return {
    statusCode,
    headers: buildCorsHeaders(event),
    body: JSON.stringify(obj)
  };
}

/* ============================================================
  //#2) FILE LOADING
============================================================ */
const __ROOT = process.cwd();

const PAY_TABLE_PATHS = [

  path.join(__ROOT, "netlify", "functions", "data", "militaryPayTables.json"),
  path.join(__ROOT, "netlify", "functions", "militaryPayTables.json")
];

let PAY_TABLES_CACHE = null;
let PAY_TABLES_PATH_USED = null;

function parseJsonFile(filePath, label) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} JSON parse failed at ${filePath}: ${String(err?.message || err)}`);
  }
}

function loadPayTables() {
  if (PAY_TABLES_CACHE) return PAY_TABLES_CACHE;

  let found = null;
  for (const p of PAY_TABLE_PATHS) {
    if (fs.existsSync(p)) {
      found = p;
      break;
    }
  }

  if (!found) {
    throw new Error(
      `militaryPayTables.json not found. Tried:\n- ${PAY_TABLE_PATHS.join("\n- ")}`
    );
  }

  PAY_TABLES_CACHE = parseJsonFile(found, "militaryPayTables");
  PAY_TABLES_PATH_USED = found;
  return PAY_TABLES_CACHE;
}

/* ============================================================
  //#3) HELPERS
============================================================ */
function toInt(x) {
  const n = Number.parseInt(String(x ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function toNum(x) {
  const n = Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : null;
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

function boolFamily(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "with", "with dependents"].includes(s)) return true;
  if (["false", "0", "no", "without", "without dependents"].includes(s)) return false;
  return false;
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

function rankTitle(rank) {
  const map = {
    "E-1": "Airman Basic",
    "E-2": "Airman",
    "E-3": "Airman First Class",
    "E-4": "Senior Airman",
    "E-5": "Staff Sergeant",
    "E-6": "Technical Sergeant",
    "E-7": "Master Sergeant",
    "E-8": "Senior Master Sergeant",
    "E-9": "Chief Master Sergeant",
    "O-1": "Second Lieutenant",
    "O-2": "First Lieutenant",
    "O-3": "Captain",
    "O-4": "Major",
    "O-5": "Lieutenant Colonel",
    "O-6": "Colonel",
    "O-7": "Brigadier General",
    "W-1": "Warrant Officer 1",
    "W-2": "Chief Warrant Officer 2",
    "W-3": "Chief Warrant Officer 3",
    "W-4": "Chief Warrant Officer 4",
    "W-5": "Chief Warrant Officer 5"
  };
  return map[rank] || rank;
}

function buildBaseToZipMap(payTables) {
  const raw =
    payTables?.BAH?.base_to_zip ||
    payTables?.BAH?.baseToZip ||
    {};

  const map = new Map();

  for (const [key, value] of Object.entries(raw)) {
    const nk = normalizeBaseName(key);
    const zip = String(value || "").trim();
    if (nk && zip) map.set(nk, zip);
  }

  return map;
}

function resolveZipFromBase(base, payTables) {
  const map = buildBaseToZipMap(payTables);
  const norm = normalizeBaseName(base);
  return map.get(norm) || null;
}

function computeBasePay(rank, yos, payTables) {
  const tableForRank = payTables?.BASEPAY?.[rank];
  if (!tableForRank) {
    throw new Error(`No BASEPAY table found for rank ${rank}`);
  }

  const value = pickNearestYos(tableForRank, yos);
  if (value == null) {
    throw new Error(`No BASEPAY value found for rank ${rank} and YOS ${yos}`);
  }

  return Number(value) || 0;
}

function computeBAS(rank, payTables) {
  const isOfficer = /^O-/.test(rank);
  const bas = isOfficer
    ? payTables?.BAS?.officer
    : payTables?.BAS?.enlisted;

  return Number(bas || 0);
}

function computeBAH(rank, zip, family, payTables) {
  const zipBlock = payTables?.BAH?.by_zip?.[zip];
  if (!zipBlock) {
    throw new Error(`No BAH data found for ZIP ${zip}`);
  }

  const bucket = family ? zipBlock?.with : zipBlock?.without;
  if (!bucket) {
    throw new Error(`No BAH ${family ? "with" : "without"} dependent bucket for ZIP ${zip}`);
  }

  const value = bucket?.[rank];
  if (value == null) {
    throw new Error(`No BAH found for rank ${rank} at ZIP ${zip}`);
  }

  return {
    bah: Number(value) || 0,
    locationLabel: String(zipBlock?.location || zipBlock?.base || zip).trim(),
    mha: String(zipBlock?.mha || "").trim() || null,
    zipBlock
  };
}

/* ============================================================
  //#4) VALIDATION
============================================================ */
function validateInputs({ rank, yos, base }) {
  if (!rank) throw new Error("Rank missing.");
  if (yos === null || yos < 0) throw new Error("Years of service missing or invalid.");
  if (!base) throw new Error("Base missing.");
}

/* ============================================================
  //#5) HANDLER
============================================================ */
exports.handler = async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: buildCorsHeaders(event),
        body: ""
      };
    }

    if (event.httpMethod === "GET") {
      return respond(event, 200, {
        ok: true,
        note: "POST JSON: { rank, yos, base, family }",
        payTablesPathUsed: PAY_TABLES_PATH_USED || null
      });
    }

    if (event.httpMethod !== "POST") {
      return respond(event, 405, {
        ok: false,
        error: "Method not allowed."
      });
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch (err) {
      return respond(event, 400, {
        ok: false,
        error: "Invalid JSON body."
      });
    }

    const payTables = loadPayTables();

    const rank = normalizeRank(body.rank);
    const yos = toInt(body.yos);
    const base = String(body.base || "").trim();
    const family = boolFamily(body.family);

    validateInputs({ rank, yos, base });

    const zip = resolveZipFromBase(base, payTables);
    if (!zip) {
      return respond(event, 400, {
        ok: false,
        error: `Base "${base}" is not mapped to a ZIP in BAH.base_to_zip.`,
        debug: {
          rank,
          yos,
          base,
          family,
          payTablesPathUsed: PAY_TABLES_PATH_USED
        }
      });
    }

    const basePay = computeBasePay(rank, yos, payTables);
    const bas = computeBAS(rank, payTables);
    const bahInfo = computeBAH(rank, zip, family, payTables);
    const bah = bahInfo.bah;
    const total = Number((basePay + bas + bah).toFixed(2));

    return respond(event, 200, {
      ok: true,
      rank,
      rankTitle: rankTitle(rank),
      yos,
      base,
      zip,
      family,
      basePay: Number(basePay.toFixed(2)),
      bah: Number(bah.toFixed(2)),
      bas: Number(bas.toFixed(2)),
      total,
      locationLabel: bahInfo.locationLabel,
      mha: bahInfo.mha,
      debug: {
        payTablesPathUsed: PAY_TABLES_PATH_USED,
        familyBucket: family ? "with" : "without"
      }
    });
  } catch (err) {
    return respond(event, 500, {
      ok: false,
      error: String(err?.message || err),
      debug: {
        payTablesPathUsed: PAY_TABLES_PATH_USED || null
      }
    });
  }
};
