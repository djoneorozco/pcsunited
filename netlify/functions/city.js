// netlify/functions/city.js
// ============================================================
// PCSUnited • City Loader — v2.1.0
//
// ROUTES:
// - GET /.netlify/functions/city?cityKey=LasVegas
// - GET /.netlify/functions/city?cityKey=Lackland
// - GET /.netlify/functions/city?base=Nellis%20AFB
// - GET /api/city?cityKey=LasVegas
// - GET /api/city?cityKey=Lackland
// - GET /api/city?base=Nellis%20AFB
//
// PURPOSE:
// - Loads a city/base JSON file from netlify/functions/cities/
// - Uses index.byBase.json as canonical routing authority when base is provided
// - Supports canonical base naming + aliases
//
// NOTES:
// - If both base and cityKey are provided, base wins
// - Uses runtime-safe paths via import.meta.url
// - For base requests, loads route.file first, then falls back to route.cityKey
// ============================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ============================================================
// //#1) RUNTIME-SAFE PATHS
// ============================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CITIES_DIR = path.join(__dirname, "cities");
const INDEX_BY_BASE_PATH = path.join(CITIES_DIR, "index.byBase.json");

// ============================================================
// //#2) CORS
// ============================================================
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

// ============================================================
// //#3) RESPONSE HELPERS
// ============================================================
function ok(body) {
  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify(body),
  };
}

function err(statusCode, message, extra = {}) {
  return {
    statusCode,
    headers: CORS,
    body: JSON.stringify({ ok: false, error: message, ...extra }),
  };
}

// ============================================================
// //#4) FILE HELPERS
// ============================================================
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

// ============================================================
// //#5) NORMALIZATION HELPERS
// ============================================================
function normalizeKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s-]/g, "")
    .trim();
}

function buildNormalizedMap(obj) {
  const map = new Map();
  for (const key of Object.keys(obj || {})) {
    map.set(normalizeKey(key), key);
  }
  return map;
}

function normalizeCityKey(raw) {
  return String(raw || "")
    .trim()
    .replace(/[^A-Za-z0-9-]/g, "");
}

// ============================================================
// //#6) INDEX LOADER
// ============================================================
function loadIndexByBase() {
  if (!fileExists(INDEX_BY_BASE_PATH)) {
    throw new Error(`Missing ${INDEX_BY_BASE_PATH}`);
  }

  const data = readJson(INDEX_BY_BASE_PATH);

  return {
    version: data?.version || "unknown",
    bases: data?.bases && typeof data.bases === "object" ? data.bases : {},
    aliases: data?.aliases && typeof data.aliases === "object" ? data.aliases : {},
  };
}

// ============================================================
// //#7) BASE RESOLUTION
// ============================================================
function resolveCanonicalBaseName(inputBase, indexBases, aliases) {
  const raw = String(inputBase || "").trim();
  if (!raw) return null;

  if (indexBases[raw]) return raw;
  if (aliases[raw]) return aliases[raw];

  const norm = normalizeKey(raw);

  const baseNormMap = buildNormalizedMap(indexBases);
  if (baseNormMap.has(norm)) return baseNormMap.get(norm);

  const aliasNormMap = buildNormalizedMap(aliases);
  if (aliasNormMap.has(norm)) {
    const aliasKey = aliasNormMap.get(norm);
    return aliases[aliasKey] || null;
  }

  return null;
}

// ============================================================
// //#8) REQUEST RESOLUTION
// ============================================================
function resolveRequest(params, indexData) {
  const rawBase = String(
    params.base || params.baseName || params.installation || ""
  ).trim();

  const rawCityKey = String(params.cityKey || "").trim();

  // ------------------------------------------------------------
  // Base request wins over cityKey
  // ------------------------------------------------------------
  if (rawBase) {
    const canonicalBase = resolveCanonicalBaseName(
      rawBase,
      indexData.bases,
      indexData.aliases
    );

    if (!canonicalBase || !indexData.bases[canonicalBase]) {
      return {
        ok: false,
        type: "base",
        requested_base: rawBase,
        canonical_base: null,
        cityKey: null,
        fileKey: null,
      };
    }

    const route = indexData.bases[canonicalBase] || {};
    const cityKey = normalizeCityKey(route.cityKey || "");
    const fileKey = normalizeCityKey(route.file || route.cityKey || "");

    if (!fileKey) {
      return {
        ok: false,
        type: "base",
        requested_base: rawBase,
        canonical_base: canonicalBase,
        cityKey: cityKey || null,
        fileKey: null,
      };
    }

    return {
      ok: true,
      type: "base",
      requested_base: rawBase,
      canonical_base: canonicalBase,
      cityKey: cityKey || null,
      fileKey,
      zip: route.zip || null,
    };
  }

  // ------------------------------------------------------------
  // Direct cityKey request
  // Example: ?cityKey=Lackland
  // ------------------------------------------------------------
  if (rawCityKey) {
    const fileKey = normalizeCityKey(rawCityKey);

    return {
      ok: !!fileKey,
      type: "cityKey",
      requested_base: null,
      canonical_base: null,
      cityKey: fileKey,
      fileKey,
      zip: null,
    };
  }

  return {
    ok: false,
    type: "missing",
    requested_base: null,
    canonical_base: null,
    cityKey: null,
    fileKey: null,
    zip: null,
  };
}

// ============================================================
// //#9) CITY FILE LOADER
// ============================================================
function loadCityJson(fileKey) {
  const filePath = path.join(CITIES_DIR, `${fileKey}.json`);

  if (!fileExists(filePath)) {
    return {
      exists: false,
      filePath,
      json: null,
    };
  }

  const json = readJson(filePath);

  if (json && json.image_url != null) {
    json.image_url = String(json.image_url);
  }

  return {
    exists: true,
    filePath,
    json,
  };
}

// ============================================================
// //#10) HANDLER
// ============================================================
export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: CORS, body: "" };
    }

    if (event.httpMethod !== "GET") {
      return err(405, "Method not allowed. Use GET.");
    }

    const params = event.queryStringParameters || {};
    const indexData = loadIndexByBase();
    const resolved = resolveRequest(params, indexData);

    if (!resolved.ok) {
      if (resolved.type === "missing") {
        return err(400, "Missing required parameter", {
          hint: "Use ?cityKey=... or ?base=...",
          index_path: INDEX_BY_BASE_PATH,
        });
      }

      if (resolved.type === "base") {
        return err(404, "Base not found in index.byBase.json", {
          requested_base: resolved.requested_base,
          version: indexData.version,
          index_path: INDEX_BY_BASE_PATH,
        });
      }

      return err(400, "Invalid request");
    }

    const cityFile = loadCityJson(resolved.fileKey);

    if (!cityFile.exists) {
      return err(404, "City file not found", {
        cityKey: resolved.cityKey,
        fileKey: resolved.fileKey,
        expected: path.join("netlify", "functions", "cities", `${resolved.fileKey}.json`),
        requested_base: resolved.requested_base,
        canonical_base: resolved.canonical_base,
        index_path: INDEX_BY_BASE_PATH,
      });
    }

    const payload =
      resolved.type === "base"
        ? {
            ...cityFile.json,
            requested_base: resolved.requested_base,
            base: resolved.canonical_base,
            canonical_base: resolved.canonical_base,
            cityKey: resolved.cityKey,
            fileKey: resolved.fileKey,
            zip: resolved.zip || null,
          }
        : {
            ...cityFile.json,
            cityKey: resolved.cityKey,
            fileKey: resolved.fileKey,
          };

    return ok(payload);
  } catch (e) {
    return err(500, "City function crashed", {
      details: String(e && e.message ? e.message : e),
      index_path: INDEX_BY_BASE_PATH,
      cities_dir: CITIES_DIR,
    });
  }
}
