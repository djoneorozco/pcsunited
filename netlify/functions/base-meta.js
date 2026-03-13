// netlify/functions/base-meta.js
// ============================================================
// PCSUnited • Base Meta Lookup — v1.0.1 (Crash-proof ESM)
// PURPOSE:
// - Browser-safe endpoint to fetch base metadata stored in:
//   netlify/functions/cities/bases.json
// - Returns base info + extra fields:
//   market_type_summary, population, avg_home_morgage_monthly, etc.
//
// ROUTES:
// - GET  /api/base-meta?base=...
// - POST /api/base-meta   { base: "..." }
//
// NOTE:
// - Requires netlify.toml included_files:
//   [functions]
//   included_files = ["netlify/functions/data/**","netlify/functions/cities/**"]
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
  try { return JSON.parse(s); } catch { return null; }
}

function normalizeKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s-]/g, "")
    .trim();
}

async function readBasesJson() {
  // ✅ No __filename / __dirname (avoids Netlify bundler redeclare crash)
  const fileUrl = new URL("./cities/bases.json", import.meta.url);
  const raw = await fs.readFile(fileUrl, "utf8");
  const data = JSON.parse(raw);

  // Supports either:
  // { "version":"1.0", "bases": { "Nellis AFB": {...} } }
  // or
  // { "Nellis AFB": {...} }
  const bases =
    data?.bases && typeof data.bases === "object"
      ? data.bases
      : data;

  return { version: data?.version || "unknown", bases };
}

function findBaseEntry(basesObj, baseName) {
  if (!basesObj || typeof basesObj !== "object") return null;
  if (!baseName) return null;

  // 1) exact key
  if (basesObj[baseName]) return { key: baseName, ...basesObj[baseName] };

  // 2) normalized key match
  const target = normalizeKey(baseName);
  for (const k of Object.keys(basesObj)) {
    if (normalizeKey(k) === target) return { key: k, ...basesObj[k] };
  }

  return null;
}

export async function handler(event) {
  try {
    // ✅ Always succeed preflight (prevents CORS blockage)
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: CORS_HEADERS, body: "" };
    }

    const method = event.httpMethod || "GET";

    let base =
      (event.queryStringParameters && event.queryStringParameters.base) ||
      "";

    if (!base && method === "POST") {
      const body = safeJsonParse(event.body || "{}") || {};
      base = body.base || body.base_name || body.installation || "";
    }

    base = String(base || "").trim();
    if (!base) {
      return respond(400, {
        ok: false,
        error: "Missing required parameter: base",
        hint: 'Use GET ?base=... or POST { "base": "..." }',
      });
    }

    const { version, bases } = await readBasesJson();
    const entry = findBaseEntry(bases, base);

    if (!entry) {
      return respond(404, {
        ok: false,
        error: "Base not found",
        base,
        version,
      });
    }

    // ✅ Return safe metadata + pass-through fields
    return respond(200, {
      ok: true,
      version,
      base: entry.key,
      meta: {
        cityKey: entry.cityKey || entry.city_key || null,
        file: entry.file || null,
        zip: entry.zip || null,

        image_url: entry.image_url || entry.imageUrl || entry.image || null,

        market_type_summary: entry.market_type_summary || null,
        population: entry.population ?? null,
        avg_home_morgage_monthly: entry.avg_home_morgage_monthly ?? null,

        ...entry, // allow future add-ons without code changes
      },
    });
  } catch (err) {
    return respond(500, {
      ok: false,
      error: "Server error",
      detail: String(err?.message || err),
    });
  }
}
