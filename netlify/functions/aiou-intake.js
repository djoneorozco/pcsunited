// netlify/functions/aiou-intake.js
// ============================================================
// PCS United • Save AIOU House Intake (v1.0.0)
// PURPOSE:
// - Accept POST payload from the PCS United AIOU House Intake embed
// - Upsert into Supabase public.user_aiou_inputs
//
// BODY (POST JSON):
// {
//   profile_id: "optional-uuid",
//   email: "optional@x.com",
//   home_year: "optional string (we accept yearBand here)",
//   bedrooms: number,
//   bathrooms: number,
//   sqft: number,
//   property_type: string,
//   amenities: string,          // free text (comma-separated ok)
//   source: "pcsunited.aiou.house_intake.v1",
//   payload: {...}              // optional raw blob (not stored unless you add a jsonb column)
// }
//
// ENV REQUIRED:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload || {}),
  };
}

function nOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanText(v, maxLen) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (maxLen && s.length > maxLen) return s.slice(0, maxLen);
  return s;
}

function cleanEmail(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  // lightweight email sanity check (don’t over-reject)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return null;
  return s;
}

exports.handler = async function (event) {
  // ============================================================
  // //#0 CORS + METHOD
  // ============================================================
  if (event.httpMethod === "OPTIONS") return respond(200, { ok: true });
  if (event.httpMethod !== "POST") return respond(405, { ok: false, error: "Method not allowed" });

  // ============================================================
  // //#1 PARSE BODY
  // ============================================================
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return respond(400, { ok: false, error: "Invalid JSON body" });
  }

  const profile_id = cleanText(body.profile_id, 64); // UUID string typically
  const email = cleanEmail(body.email);

  // We need *something* to associate the row with a user
  if (!profile_id && !email) {
    return respond(400, {
      ok: false,
      error: "profile_id or a valid email is required",
    });
  }

  // ============================================================
  // //#2 NORMALIZE FIELDS (match your table columns)
  // ============================================================
  // Your table has home_year but you removed Year Built in the UI.
  // We’ll store the derived “year band” string here (ex: "2024–2025" or "≤ 2016" or "2–7 years").
  const home_year = cleanText(body.home_year || body.yearBand || body.condition_year_band, 64);

  const bedrooms = nOrNull(body.bedrooms);
  const bathrooms = nOrNull(body.bathrooms);
  const sqft = nOrNull(body.sqft);

  const property_type = cleanText(body.property_type || body.propertyType, 64);

  // Save amenities as a text field (comma-separated is fine)
  // If the embed sends amenities[] we’ll join it.
  let amenities = null;
  if (Array.isArray(body.amenities)) {
    amenities = body.amenities.map(x => String(x || "").trim()).filter(Boolean).slice(0, 60).join(", ");
  } else {
    amenities = cleanText(body.amenities || body.amenitiesText, 400);
  }

  const source = cleanText(body.source, 80) || "pcsunited.aiou.house_intake.v1";

  // ============================================================
  // //#3 SUPABASE CLIENT
  // ============================================================
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return respond(500, { ok: false, error: "Supabase env not configured" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ============================================================
  // //#4 UPSERT (profile_id preferred; else email)
  // ============================================================
  const row = {
    profile_id: profile_id || null,
    email: email || null,
    home_year: home_year || null,
    bedrooms,
    bathrooms,
    sqft,
    property_type: property_type || null,
    amenities: amenities || null,
    updated_at: new Date().toISOString(),
    // NOTE: If you later add a jsonb column like "payload", we can store body.payload safely.
    // payload: (body.payload && typeof body.payload === "object") ? body.payload : null,
    source, // NOTE: if your table doesn't have "source", remove this line.
  };

  // ⚠️ If your table does NOT have a "source" column, Supabase will throw.
  // If you’re not sure, delete `source` from row above.

  const conflictCol = profile_id ? "profile_id" : "email";

  const { error } = await supabase
    .from("user_aiou_inputs")
    .upsert([row], { onConflict: conflictCol });

  if (error) {
    console.error("PCS United aiou-intake error:", error);
    return respond(500, { ok: false, error: error.message || "DB upsert failed" });
  }

  return respond(200, {
    ok: true,
    message: "AIOU intake saved.",
    upserted_on: conflictCol,
    email: email || null,
    profile_id: profile_id || null,
  });
};
