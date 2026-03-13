// netlify/functions/city.js
// PCSUnited • City Loader
// GET /.netlify/functions/city?cityKey=Nellis
// GET /api/city?cityKey=Nellis  (via netlify.toml redirect)

import fs from "fs";
import path from "path";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function ok(body) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(body) };
}

function err(statusCode, message, extra = {}) {
  return {
    statusCode,
    headers: CORS,
    body: JSON.stringify({ ok: false, error: message, ...extra }),
  };
}

function normalizeKey(raw) {
  const s = String(raw || "").trim();
  if (!s) return "Lackland";

  // common variants -> your actual filenames
  if (/^san\s*antonio$/i.test(s) || /^sanantonio$/i.test(s)) return "Lackland";
  if (/^fort\s*sam\s*houston$/i.test(s) || /^fortsamhouston$/i.test(s)) return "Fort-Sam-Houston";

  // keep hyphenated bases like Davis-Monthan, Fort-Sam-Houston
  // strip weird chars but preserve hyphens
  return s.replace(/[^A-Za-z0-9-]/g, "");
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
    const cityKey = normalizeKey(params.cityKey);

    const filePath = path.join(process.cwd(), "netlify", "functions", "cities", `${cityKey}.json`);

    if (!fs.existsSync(filePath)) {
      return err(404, "City file not found", { cityKey, expected: `netlify/functions/cities/${cityKey}.json` });
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const json = JSON.parse(raw);

    // Helpful: ensure image_url exists as string when present
    if (json && json.image_url != null) json.image_url = String(json.image_url);

    return ok(json);
  } catch (e) {
    return err(500, "City function crashed", { details: String(e && e.message ? e.message : e) });
  }
}
