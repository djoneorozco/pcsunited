// netlify/functions/base-meta.js
// ============================================================
// PCSUnited • Base Meta Lookup — v2.0.0 (Canonical Index Router)
// PURPOSE:
// - Browser-safe endpoint to fetch base metadata using:
//   1) netlify/functions/cities/index.byBase.json  <- canonical router
//   2) netlify/functions/cities/bases.json         <- optional rich metadata
//
// ROUTES:
// - GET  /api/base-meta?base=...
// - POST /api/base-meta   { base: "..." }
//
// RETURNS:
// - canonical base name (your official 44-base naming standard)
// - cityKey, file, zip from index.byBase.json
// - any extra metadata from bases.json when available
//
// NOTES:
// - Canonical naming uses your official AFB names
// - Aliases are resolved from index.byBase.json
// - Safe for Netlify ESM bundling
// ============================================================

import fs from "fs/promises";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload),
  };
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s-]/g, "")
    .trim();
}

async function readJsonFromCities(filename) {
  const fileUrl = new URL(`./cities/${filename}`, import.meta.url);
  const raw = await fs.readFile(fileUrl, "utf8");
  return JSON.parse(raw);
}

async function readIndexByBase() {
  const data = await readJsonFromCities("index.byBase.json");

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

async function readBasesJsonOptional() {
  try {
    const data = await readJsonFromCities("bases.json");

    const bases =
      data?.bases && typeof data.bases === "object"
        ? data.bases
        : data && typeof data === "object"
          ? data
          : {};

    return {
      version: data?.version || "unknown",
      bases,
    };
  } catch {
    return {
      version: "missing",
      bases: {},
    };
  }
}

function buildNormalizedMap(obj) {
  const out = new Map();
  for (const key of Object.keys(obj || {})) {
    out.set(normalizeKey(key), key);
  }
  return out;
}

function resolveCanonicalBaseName(inputBase, indexBases, aliases) {
  if (!inputBase) return null;

  const raw = String(inputBase).trim();
  if (!raw) return null;

  // 1) exact canonical match
  if (indexBases[raw]) {
    return raw;
  }

  // 2) exact alias match
  if (aliases[raw]) {
    return aliases[raw];
  }

  const norm = normalizeKey(raw);

  // 3) normalized canonical match
  const baseNormMap = buildNormalizedMap(indexBases);
  if (baseNormMap.has(norm)) {
    return baseNormMap.get(norm);
  }

  // 4) normalized alias match
  const aliasNormMap = buildNormalizedMap(aliases);
  if (aliasNormMap.has(norm)) {
    const aliasKey = aliasNormMap.get(norm);
    return aliases[aliasKey] || null;
  }

  return null;
}

function findMetaEntry(metaBases, canonicalBase, requestedBase) {
  if (!metaBases || typeof metaBases !== "object") return null;

  const candidates = [
    canonicalBase,
    requestedBase,
    canonicalBase?.replace(/\s+AFB$/i, ""),
    canonicalBase?.replace(/\s+AFB$/i, "").replace(/-/g, " "),
    canonicalBase?.replace(/\s+AFB$/i, "").replace(/-/g, ""),
    requestedBase?.replace(/\s+AFB$/i, ""),
  ].filter(Boolean);

  for (const c of candidates) {
    if (metaBases[c]) return { key: c, value: metaBases[c] };
  }

  const targetNorms = new Set(candidates.map(normalizeKey));

  for (const k of Object.keys(metaBases)) {
    if (targetNorms.has(normalizeKey(k))) {
      return { key: k, value: metaBases[k] };
    }
  }

  return null;
}

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: CORS_HEADERS, body: "" };
    }

    const method = event.httpMethod || "GET";

    let base =
      (event.queryStringParameters && event.queryStringParameters.base) ||
      "";

    if (!base && method === "POST") {
      const body = safeJsonParse(event.body || "{}") || {};
      base =
        body.base ||
        body.base_name ||
        body.installation ||
        body.baseName ||
        "";
    }

    base = String(base || "").trim();

    if (!base) {
      return respond(400, {
        ok: false,
        error: "Missing required parameter: base",
        hint: 'Use GET ?base=... or POST { "base": "..." }',
      });
    }

    const indexData = await readIndexByBase();
    const metaData = await readBasesJsonOptional();

    const canonicalBase = resolveCanonicalBaseName(
      base,
      indexData.bases,
      indexData.aliases
    );

    if (!canonicalBase || !indexData.bases[canonicalBase]) {
      return respond(404, {
        ok: false,
        error: "Base not found",
        requested_base: base,
        version: indexData.version,
      });
    }

    const routeEntry = indexData.bases[canonicalBase] || {};
    const metaEntry = findMetaEntry(metaData.bases, canonicalBase, base);
    const extraMeta = metaEntry?.value && typeof metaEntry.value === "object"
      ? metaEntry.value
      : {};

    const mergedMeta = {
      ...extraMeta,
      cityKey: routeEntry.cityKey || extraMeta.cityKey || extraMeta.city_key || null,
      file: routeEntry.file || extraMeta.file || null,
      zip: routeEntry.zip || extraMeta.zip || null,
      canonical_base: canonicalBase,
      requested_base: base,
      image_url:
        extraMeta.image_url ||
        extraMeta.imageUrl ||
        extraMeta.image ||
        null,
      market_type_summary: extraMeta.market_type_summary || null,
      population: extraMeta.population ?? null,
      avg_home_morgage_monthly: extraMeta.avg_home_morgage_monthly ?? null,
    };

    return respond(200, {
      ok: true,
      version: indexData.version,
      base: canonicalBase,
      meta: mergedMeta,
    });
  } catch (err) {
    return respond(500, {
      ok: false,
      error: "Server error",
      detail: String(err?.message || err),
    });
  }
}
