// netlify/functions/city.js
// ============================================================
// PCSUnited • City Loader — v2.0.0
//
// ROUTES:
// - GET /.netlify/functions/city?cityKey=LasVegas
// - GET /.netlify/functions/city?base=Nellis%20AFB
// - GET /api/city?cityKey=LasVegas
// - GET /api/city?base=Nellis%20AFB
//
// PURPOSE:
// - Loads a city JSON file from netlify/functions/cities/
// - Uses index.byBase.json as canonical routing authority when base is provided
// - Supports canonical 44-base AFB naming + aliases
//
// NOTES:
// - If both base and cityKey are provided, base wins
// - Safe for Netlify Functions
// ============================================================

import fs from "fs";
import path from "path";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

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

function loadIndexByBase() {
  const indexPath = path.join(
    process.cwd(),
    "netlify",
    "functions",
    "cities",
    "index.byBase.json"
  );

  if (!fs.existsSync(indexPath)) {
    throw new Error("Missing netlify/functions/cities/index.byBase.json");
  }

  const data = readJson(indexPath);

  return {
    version: data?.version || "unknown",
    bases:
      data?.bases && typeof data.bases === "object"
        ? data.bases
        : {},
    aliases:
      data?.aliases && typeof data.aliases === "object"
        ? data.aliases
        : {},
  };
}

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

function normalizeCityKey(raw) {
  return String(raw || "")
    .trim()
    .replace(/[^A-Za-z0-9-]/g, "");
}

function resolveCityKeyFromRequest(params, indexData) {
  const rawBase = String(params.base || params.baseName || params.installation || "").trim();
  const rawCityKey = String(params.cityKey || "").trim();

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
      };
    }

    const route = indexData.bases[canonicalBase] || {};
    const cityKey = normalizeCityKey(route.cityKey || "");

    if (!cityKey) {
      return {
        ok: false,
        type: "base",
        requested_base: rawBase,
        canonical_base: canonicalBase,
        cityKey: null,
      };
    }

    return {
      ok: true,
      type: "base",
      requested_base: rawBase,
      canonical_base: canonicalBase,
      cityKey,
      file: route.file || null,
      zip: route.zip || null,
    };
  }

  if (rawCityKey) {
    const cityKey = normalizeCityKey(rawCityKey);
    return {
      ok: !!cityKey,
      type: "cityKey",
      requested_base: null,
      canonical_base: null,
      cityKey,
      file: null,
      zip: null,
    };
  }

  return {
    ok: false,
    type: "missing",
    requested_base: null,
    canonical_base: null,
    cityKey: null,
  };
}

function loadCityJson(cityKey) {
  const filePath = path.join(
    process.cwd(),
    "netlify",
    "functions",
    "cities",
    `${cityKey}.json`
  );

  if (!fs.existsSync(filePath)) {
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

    const resolved = resolveCityKeyFromRequest(params, indexData);

    if (!resolved.ok) {
      if (resolved.type === "missing") {
        return err(400, "Missing required parameter", {
          hint: "Use ?cityKey=... or ?base=...",
        });
      }

      if (resolved.type === "base") {
        return err(404, "Base not found in index.byBase.json", {
          requested_base: resolved.requested_base,
          version: indexData.version,
        });
      }

      return err(400, "Invalid request");
    }

    const cityFile = loadCityJson(resolved.cityKey);

    if (!cityFile.exists) {
      return err(404, "City file not found", {
        cityKey: resolved.cityKey,
        expected: `netlify/functions/cities/${resolved.cityKey}.json`,
        requested_base: resolved.requested_base,
        canonical_base: resolved.canonical_base,
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
            base_file: resolved.file || null,
            zip: resolved.zip || null,
          }
        : {
            ...cityFile.json,
            cityKey: resolved.cityKey,
          };

    return ok(payload);
  } catch (e) {
    return err(500, "City function crashed", {
      details: String(e && e.message ? e.message : e),
    });
  }
}
