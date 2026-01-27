// netlify/functions/aiou-intake.js
// ============================================================
// PCS United • Save AIOU House Intake (v1.1.0) — ESM SAFE
// PURPOSE:
// - Accept POST payload from AIOU House Intake embed
// - Upsert/update into Supabase public.user_aiou_inputs
// - (Optional but helpful) also updates public.profiles.mode if provided
//
// ENV REQUIRED:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
// ============================================================

import { createClient } from "@supabase/supabase-js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Vary": "Origin",
};

function respond(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload || {}) };
}

function nOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sOrNull(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

export const handler = async (event) => {
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
  } catch {
    return respond(400, { ok: false, error: "Invalid JSON body" });
  }

  const email = sOrNull(body.email)?.toLowerCase() || null;
  const profile_id = sOrNull(body.profile_id) || null;

  // Support both naming styles (your UI might send either)
  const home_year = sOrNull(body.home_year ?? body.yearBand) || null;

  const bedrooms = nOrNull(body.bedrooms);
  const bathrooms = nOrNull(body.bathrooms);
  const sqft = nOrNull(body.sqft);

  const property_type = sOrNull(body.property_type) || null;
  const amenities = sOrNull(body.amenities) || null;

  // NEW: support home_condition too (your screenshot shows you want this)
  const home_condition = sOrNull(body.home_condition ?? body.conditionPreference) || null;

  // Optional: if your flow includes "mode" (ready/soon/unsure), we can update profiles.mode
  const mode = sOrNull(body.mode) || null;

  // You can require email if you want hard consistency:
  if (!email) return respond(400, { ok: false, error: "email is required" });

  // ============================================================
  // //#2 SUPABASE CLIENT
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
  // //#3 UPSERT/UPDATE AIOU INPUTS
  // ============================================================
  const nowIso = new Date().toISOString();

  const row = {
    profile_id,
    email,
    home_year,
    bedrooms,
    bathrooms,
    sqft,
    property_type,
    amenities,
    home_condition,
    updated_at: nowIso,
  };

  try {
    // Try: update latest row by email (no unique constraint required)
    const { data: existing, error: selErr } = await supabase
      .from("user_aiou_inputs")
      .select("id")
      .eq("email", email)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (!selErr && existing && existing.length) {
      const id = existing[0].id;

      const { error: updErr } = await supabase
        .from("user_aiou_inputs")
        .update(row)
        .eq("id", id);

      if (updErr) {
        console.error("aiou-intake update error:", updErr);
        return respond(500, { ok: false, error: updErr.message || "DB update failed" });
      }

      // Optional: update profiles.mode
      if (mode) {
        const { error: pErr } = await supabase
          .from("profiles")
          .update({ mode, updated_at: nowIso })
          .eq("email", email);

        if (pErr) console.warn("profiles mode update warning:", pErr);
      }

      return respond(200, { ok: true, message: "AIOU intake updated.", id });
    }

    // Otherwise insert
    const { data: insData, error: insErr } = await supabase
      .from("user_aiou_inputs")
      .insert([row])
      .select("id")
      .limit(1);

    if (insErr) {
      console.error("aiou-intake insert error:", insErr);
      return respond(500, { ok: false, error: insErr.message || "DB insert failed" });
    }

    // Optional: update profiles.mode
    if (mode) {
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ mode, updated_at: nowIso })
        .eq("email", email);

      if (pErr) console.warn("profiles mode update warning:", pErr);
    }

    const id = insData && insData[0] ? insData[0].id : null;
    return respond(200, { ok: true, message: "AIOU intake saved.", id });
  } catch (e) {
    console.error("aiou-intake fatal:", e);
    return respond(500, { ok: false, error: "Server error" });
  }
};
