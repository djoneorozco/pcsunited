// netlify/functions/city.js
// ============================================================
// PCSUnited • City Loader — v2.2.0
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
// - Uses index.byBase.json only when base is provided
// - Supports canonical base naming + aliases
//
// NOTES:
// - If both base and cityKey are provided, base wins
// - cityKey requests DO NOT depend on index.byBase.json
// - Uses safe multi-path lookup to avoid Netlify runtime path issues
// ============================================================

import fs from "fs";
import path from "path";

// ============================================================
// //#1) CORS
// ============================================================
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

// ============================================================
// //#2) RESPONSE HELPERS
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
    body: JSON.stringify({
      ok: false,
      error: message,
      ...extra,
    }),
  };
}

// ============================================================
// //#3) NORMALIZATION HELPERS
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

function normalizeCityKey(raw) {
  return String(raw || "")
    .trim()
    .replace(/[^A-Za-z0-9-]/g, "");
}

function buildNormalizedMap(obj) {
  const map = new Map();
  for (const key of Object.keys(obj || {})) {
    map.set(normalizeKey(key), key);
  }
  return map;
}

// ============================================================
// //#4) FILE HELPERS
// ============================================================
function fileExists(filePath) {
  try {
    return !!filePath && fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

// ============================================================
// //#5) CITIES DIRECTORY RESOLUTION
// ============================================================
function getCitiesDirCandidates() {
  const cwd = process.cwd();

  return uniquePaths([
    path.join(cwd, "netlify", "functions", "cities"),
    path.join(cwd, "cities"),
    path.join("/var/task", "netlify", "functions", "cities"),
    path.join("/var/task", "cities"),
  ]);
}

function resolveCitiesDir() {
  const candidates = getCitiesDirCandidates();

  for (const dir of candidates) {
    if (fileExists(dir)) return dir;
  }

  return null;
}

function resolveIndexPath() {
  const dirs = getCitiesDirCandidates();
  for (const dir of dirs) {
    const candidate = path.join(dir, "index.byBase.json");
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

function resolveCityFilePath(fileKey) {
  const safeKey = normalizeCityKey(fileKey);
  const dirs = getCitiesDirCandidates();

  for (const dir of dirs) {
    const candidate = path.join(dir, `${safeKey}.json`);
    if (fileExists(candidate)) return candidate;
  }

  return null;
}

// ============================================================
// //#6) INDEX LOADER
// ============================================================
function loadIndexByBase() {
  const indexPath = resolveIndexPath();

  if (!indexPath) {
    throw new Error("Missing index.byBase.json");
  }

  const data = readJson(indexPath);

  return {
    indexPath,
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
function resolveRequest(params, indexData = null) {
  const rawBase = String(
    params.base || params.baseName || params.installation || ""
  ).trim();

  const rawCityKey = String(params.cityKey || "").trim();

  // ------------------------------------------------------------
  // Base request wins
  // ------------------------------------------------------------
  if (rawBase) {
    if (!indexData) {
      return {
        ok: false,
        type: "missing-index",
        requested_base: rawBase,
        canonical_base: null,
        cityKey: null,
        fileKey: null,
      };
    }

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
  // This path does NOT require index.byBase.json
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
// //#9) CITY LOADER
// ============================================================
function loadCityJson(fileKey) {
  const filePath = resolveCityFilePath(fileKey);

  if (!filePath) {
    return {
      exists: false,
      filePath: null,
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
      return {
        statusCode: 200,
        headers: CORS,
        body: "",
      };
    }

    if (event.httpMethod !== "GET") {
      return err(405, "Method not allowed. Use GET.");
    }

    const params = event.queryStringParameters || {};
    const rawBase = String(
      params.base || params.baseName || params.installation || ""
    ).trim();

    let indexData = null;

    // Only load index if base was provided
    if (rawBase) {
      indexData = loadIndexByBase();
    }

    const resolved = resolveRequest(params, indexData);

    if (!resolved.ok) {
      if (resolved.type === "missing") {
        return err(400, "Missing required parameter", {
          hint: "Use ?cityKey=... or ?base=...",
          cities_dir_candidates: getCitiesDirCandidates(),
        });
      }

      if (resolved.type === "missing-index") {
        return err(500, "Base routing index is missing", {
          requested_base: resolved.requested_base,
          cities_dir_candidates: getCitiesDirCandidates(),
        });
      }

      if (resolved.type === "base") {
        return err(404, "Base not found in index.byBase.json", {
          requested_base: resolved.requested_base,
          version: indexData?.version || "unknown",
          index_path: indexData?.indexPath || null,
        });
      }

      return err(400, "Invalid request");
    }

    const cityFile = loadCityJson(resolved.fileKey);

    if (!cityFile.exists) {
      return err(404, "City file not found", {
        cityKey: resolved.cityKey,
        fileKey: resolved.fileKey,
        expected: `netlify/functions/cities/${resolved.fileKey}.json`,
        requested_base: resolved.requested_base,
        canonical_base: resolved.canonical_base,
        cities_dir_candidates: getCitiesDirCandidates(),
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
      cities_dir_candidates: getCitiesDirCandidates(),
      resolved_cities_dir: resolveCitiesDir(),
      resolved_index_path: resolveIndexPath(),
    });
  }
}
