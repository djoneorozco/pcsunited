// netlify/functions/aiou-intake.js
// ============================================================
// PCS United • Save AIOU House Intake (v1.0.0)
// PURPOSE:
// - Accept POST payload from the PCS United AIOU House Intake embed
// - Insert or update into Supabase public.user_aiou_inputs
//   (matches your existing table columns)
//
// BODY (POST JSON):
// {
//   email: "user@x.com",                 // recommended
//   profile_id: "uuid-optional",
//   home_year: "2019–2024" | "≤ 2018" | "0–1 years" | etc,
//   bedrooms: number,
//   bathrooms: number,
//   sqft: number,
//   property_type: string,
//   amenities: string                    // store as text (comma separated)
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

function sOrNull(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
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
  } catch (_) {
    return respond(400, { ok: false, error: "Invalid JSON body" });
  }

  const email = sOrNull(body.email)?.toLowerCase() || null;
  const profile_id = sOrNull(body.profile_id) || null;

  const home_year = sOrNull(body.home_year) || null;
  const bedrooms = nOrNull(body.bedrooms);
  const bathrooms = nOrNull(body.bathrooms);
  const sqft = nOrNull(body.sqft);
  const property_type = sOrNull(body.property_type) || null;
  const amenities = sOrNull(body.amenities) || null;

  // We allow saving without email (nullable), but email is strongly preferred.
  // If you want to require email, uncomment below:
  // if (!email) return respond(400, { ok:false, error:"email is required" });

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
  // //#3 INSERT OR UPDATE (NO UNIQUE CONSTRAINT REQUIRED)
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
    updated_at: nowIso,
  };

  try {
    // If we have an email, try to update the existing row first
    if (email) {
      const { data: existing, error: selErr } = await supabase
        .from("user_aiou_inputs")
        .select("id")
        .eq("email", email)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (selErr) {
        console.error("PCS United aiou-intake select error:", selErr);
        // Fall through to insert attempt
      } else if (existing && existing.length) {
        const id = existing[0].id;
        const { error: updErr } = await supabase
          .from("user_aiou_inputs")
          .update(row)
          .eq("id", id);

        if (updErr) {
          console.error("PCS United aiou-intake update error:", updErr);
          return respond(500, { ok: false, error: updErr.message || "DB update failed" });
        }

        return respond(200, { ok: true, message: "AIOU intake updated.", id });
      }
    }

    // Otherwise insert a new row
    const { data: insData, error: insErr } = await supabase
      .from("user_aiou_inputs")
      .insert([row])
      .select("id")
      .limit(1);

    if (insErr) {
      console.error("PCS United aiou-intake insert error:", insErr);
      return respond(500, { ok: false, error: insErr.message || "DB insert failed" });
    }

    const id = insData && insData[0] ? insData[0].id : null;
    return respond(200, { ok: true, message: "AIOU intake saved.", id });
  } catch (e) {
    console.error("PCS United aiou-intake fatal:", e);
    return respond(500, { ok: false, error: "Server error" });
  }
};
