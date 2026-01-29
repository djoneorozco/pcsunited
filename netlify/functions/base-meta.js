// netlify/functions/base-meta.js
// ============================================================
// PCSUnited • Base Meta Lookup — v1.0.0
// PURPOSE:
// - Browser-safe endpoint to fetch base metadata stored in:
//   netlify/functions/cities/bases.json
// - Returns base info: file, zip, cityKey, image_url, plus extra fields:
//   market_type_summary, population, avg_home_morgage_monthly, etc.
//
// ROUTE (via /api/* redirect):
// - GET  /api/base-meta?base=...        (recommended for quick tests)
// - POST /api/base-meta   { base: "..." }
//
// REQUIRES netlify.toml included_files:
// [functions]
// included_files = ["netlify/functions/data/**","netlify/functions/cities/**"]
// ============================================================

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
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
  const filePath = path.join(__dirname, "cities", "bases.json");
  const raw = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(raw);

  // Supports either:
  // { bases: { "Nellis AFB": {...} } }
  // or
  // { "Nellis AFB": {...} }
  const bases = data?.bases && typeof data.bases === "object" ? data.bases : data;

  return { version: data?.version || "unknown", bases };
}

function findBaseEntry(basesObj, baseName) {
  if (!basesObj || typeof basesObj !== "object") return null;
  if (!baseName) return null;

  // 1) exact key match
  if (basesObj[baseName]) return { key: baseName, ...basesObj[baseName] };

  // 2) normalized match (handles small spacing/punctuation differences)
  const target = normalizeKey(baseName);
  let bestKey = null;

  for (const k of Object.keys(basesObj)) {
    if (normalizeKey(k) === target) {
      bestKey = k;
      break;
    }
  }

  if (!bestKey) return null;
  return { key: bestKey, ...basesObj[bestKey] };
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
      base = body.base || body.base_name || body.installation || "";
    }

    base = String(base || "").trim();

    if (!base) {
      return respond(400, {
        ok: false,
        error: "Missing required parameter: base",
        hint: 'Send ?base=... (GET) or { "base": "..." } (POST).',
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

    // Return *only* safe metadata (no secrets)
    return respond(200, {
      ok: true,
      version,
      base: entry.key,
      meta: {
        cityKey: entry.cityKey || entry.city_key || null,
        file: entry.file || null,
        zip: entry.zip || null,

        // Optional: allow you to store direct webflow CDN links per base
        image_url: entry.image_url || entry.imageUrl || entry.image || null,

        // Your new fields
        market_type_summary: entry.market_type_summary || null,
        population: entry.population ?? null,
        avg_home_morgage_monthly: entry.avg_home_morgage_monthly ?? null,

        // Pass-through any extras you add later
        ...entry,
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
